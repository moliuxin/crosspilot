"""页面编辑器端点：页面增删改查 + 组件树保存 + AI 改写。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import scoped_get
from ..services import ai_service
from ..utils import new_id, slugify

router = APIRouter(prefix="/pages", tags=["pages"])


def _default_sections() -> list[dict]:
    """新页面的默认区块结构（与前端编辑器初始组件树一致）。"""
    return [
        {
            "id": "sec_hero",
            "type": "hero",
            "label": "Hero 首屏",
            "props": {
                "eyebrow": "INDUSTRIAL WATER SOLUTIONS",
                "title": "Smarter Flow. Stronger Operations.",
                "description": "Reliable treatment systems engineered for global industrial projects.",
                "cta": "Explore Products",
            },
        },
        {
            "id": "sec_trust",
            "type": "trust",
            "label": "信任背书",
            "props": {"items": ["ISO 9001", "CE CERTIFIED", "OEM / ODM", "24H RESPONSE"]},
        },
        {
            "id": "sec_products",
            "type": "products",
            "label": "核心产品",
            "props": {"eyebrow": "CORE PRODUCTS", "title": "Engineered for Reliable Performance"},
        },
        {
            "id": "sec_applications",
            "type": "applications",
            "label": "应用场景",
            "props": {"eyebrow": "APPLICATIONS", "title": "Built for Demanding Environments"},
        },
        {
            "id": "sec_capability",
            "type": "capability",
            "label": "企业能力",
            "props": {"eyebrow": "CAPABILITY", "title": "From Design to Commissioning"},
        },
        {
            "id": "sec_cases",
            "type": "cases",
            "label": "项目案例",
            "props": {"eyebrow": "CASE STUDIES", "title": "Delivered Worldwide"},
        },
        {
            "id": "sec_cta",
            "type": "cta",
            "label": "询盘 CTA",
            "props": {"title": "Get a Quote in 24 Hours", "cta": "Send Inquiry"},
        },
    ]


def _seed_pages_if_empty(db: Session, tenant_id: int, site_id: str = "") -> None:
    """首次访问页面列表时播种一套默认页面（租户级隔离；带 site_id 时按站点播种）。"""
    q = db.query(models.Page).filter(models.Page.tenant_id == tenant_id)
    if site_id:
        q = q.filter(models.Page.site_id == site_id)
    if q.count() > 0:
        return
    from .sites import seed_site_pages

    if site_id:
        site = db.get(models.Site, site_id)
        if site is not None:
            seed_site_pages(db, tenant_id, site)
            db.commit()
            return
    presets = [
        ("首页", "/", True, 0),
        ("产品中心", "/products", False, 1),
        ("解决方案", "/solutions", False, 2),
        ("案例", "/cases", False, 3),
        ("关于我们", "/about", False, 4),
        ("联系我们", "/contact", False, 5),
    ]
    for name, slug, is_home, idx in presets:
        db.add(
            models.Page(
                id=new_id("page"),
                tenant_id=tenant_id,
                site_id=site_id,
                name=name,
                slug=slug,
                sections=_default_sections() if is_home else _default_sections()[:3],
                is_home=is_home,
                order_index=idx,
                seo_title=f"{name} | AQUAFLOW",
                seo_description=f"{name} page of AQUAFLOW industrial water treatment.",
            )
        )
    db.commit()


@router.get("")
def list_pages(site_id: str = "", db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """页面列表。带 ?site_id= 时只返回该站点页面（站点作用域校验归属）。"""
    from ..tenancy import require_site

    if site_id:
        require_site(db, tid, site_id)
        _seed_pages_if_empty(db, tid, site_id)
        items = (
            db.query(models.Page)
            .filter(models.Page.tenant_id == tid, models.Page.site_id == site_id)
            .order_by(models.Page.order_index.asc())
            .all()
        )
    else:
        _seed_pages_if_empty(db, tid)
        items = (
            db.query(models.Page)
            .filter(models.Page.tenant_id == tid)
            .order_by(models.Page.order_index.asc())
            .all()
        )
    return [p.to_dict() for p in items]


@router.get("/{page_id}")
def get_page(page_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    _seed_pages_if_empty(db, tid)
    p = scoped_get(db, models.Page, page_id, tid, detail="页面不存在")
    return p.to_dict()


@router.post("", status_code=201)
def create_page(payload: schemas.PageCreate, site_id: str = "", db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    from ..tenancy import default_site, require_site

    target_site = require_site(db, tid, site_id) if site_id else default_site(db, tid)
    _seed_pages_if_empty(db, tid, target_site.id)
    max_idx = (
        db.query(func.max(models.Page.order_index))
        .filter(models.Page.tenant_id == tid, models.Page.site_id == target_site.id)
        .scalar()
    )
    page = models.Page(
        id=new_id("page"),
        tenant_id=tid,
        site_id=target_site.id,
        name=payload.name,
        slug=payload.slug or f"/{slugify(payload.name)}",
        sections=[s.model_dump() for s in payload.sections] or _default_sections(),
        is_home=payload.is_home,
        seo_title=payload.seo_title or f"{payload.name} | {target_site.name}",
        seo_description=payload.seo_description,
        order_index=(max_idx or 0) + 1,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return {"ok": True, "page": page.to_dict()}


@router.put("/{page_id}")
def update_page(page_id: str, payload: schemas.PageUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """保存页面：名称、组件树（含顺序）、SEO 信息。

    sections 采用「合并」而非整体替换：以客户端提交的数组顺序为准，
    按 id 覆盖同 id 的旧区块，未提交的旧区块保留在末尾。

    为什么不整体替换：编辑器在「样式」面板只把样式写进当前选中区块，
    若提交时整棵树上报，服务器就要承担全量替换的语义风险 —— 一旦客户端
    只提交了局部区块，其余区块会被静默删除，站点结构就凭空消失。
    合并语义下「只改一个区块」永远是安全的。
    """
    p = scoped_get(db, models.Page, page_id, tid, detail="页面不存在")

    # 页面编辑同样要留版本：总指令要求「页面发布/编辑也产生版本记录」。
    # 此前 PUT /pages/{id} 直接改库不记版本，回滚功能对页面形同虚设。
    before_snapshot = p.to_dict()

    data = payload.model_dump(exclude_unset=True)
    sections_changed = False
    if "sections" in data and data["sections"] is not None:
        p.sections = _merge_sections(p.sections or [], data["sections"])
        sections_changed = True
    for key in ("name", "slug", "is_home", "seo_title", "seo_description"):
        if key in data and data[key] is not None:
            setattr(p, key, data[key])
    db.flush()

    # 只有内容真的变了才记版本，避免无意义的噪声版本
    after_snapshot = p.to_dict()
    meaningful = _page_meaningful_change(before_snapshot, after_snapshot)

    # 权限校验放在写库之后、commit 之前：403/402 时整个事务回滚，
    # 保证「没权限 = 什么都没发生」，不会留下半截脏写（E2E 已断言 402 不改状态）。
    entitlements.require_feature(db, tid, "page.publish")

    if meaningful:
        last = (
            db.query(models.Version.version_no)
            .filter(
                models.Version.tenant_id == tid,
                models.Version.entity_type == "page",
                models.Version.entity_id == page_id,
            )
            .order_by(models.Version.version_no.desc())
            .first()
        )
        db.add(
            models.Version(
                id=new_id("ver"),
                tenant_id=tid,
                site_id=p.site_id or "",
                entity_type="page",
                entity_id=page_id,
                version_no=(last[0] + 1) if last else 1,
                before_snapshot=before_snapshot,
                after_snapshot=after_snapshot,
                action="edit",
                published_by="merchant",
            )
        )

    db.commit()
    db.refresh(p)
    return {"ok": True, "page": p.to_dict()}


def _page_meaningful_change(before: dict, after: dict) -> bool:
    """忽略 updated_at 之类的噪声字段，判断是否有实质内容变化。"""
    keys = ("name", "slug", "sections", "is_home", "seo_title", "seo_description")
    return any(before.get(k) != after.get(k) for k in keys)


def _merge_sections(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """按 id 合并区块：提交顺序为准，同 id 用新值，未提交的旧区块追加在末尾。"""
    by_id = {s.get("id"): s for s in existing if isinstance(s, dict) and s.get("id")}
    merged: list[dict] = []
    seen: set[str] = set()
    for s in incoming:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if sid and sid in by_id:
            # 深合并 props：客户端可能只带部分字段，避免把没提交的 props 覆盖掉
            old = by_id[sid]
            old_props = old.get("props") or {}
            new_props = s.get("props") or {}
            merged.append({**old, **s, "props": {**old_props, **new_props}})
        else:
            merged.append(s)
        if sid:
            seen.add(sid)
    for s in existing:
        if isinstance(s, dict) and s.get("id") not in seen:
            merged.append(s)
    return merged


@router.delete("/{page_id}")
def delete_page(page_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    p = scoped_get(db, models.Page, page_id, tid, detail="页面不存在")
    if p.is_home:
        raise HTTPException(status_code=400, detail="首页不可删除")
    db.delete(p)
    db.commit()
    return {"ok": True, "id": page_id}


@router.post("/{page_id}/ai-rewrite")
async def ai_rewrite(page_id: str, payload: schemas.PageAiRewriteRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """AI 改写区块文案，返回建议值（前端确认后再保存）。"""
    p = scoped_get(db, models.Page, page_id, tid, detail="页面不存在")

    sections = p.sections or []
    target = None
    for s in sections:
        if s.get("id") == payload.section_id:
            target = s
            break
    if target is None and sections:
        target = sections[0]
    if target is None:
        raise HTTPException(status_code=400, detail="该页面没有可改写的区块")

    props = target.get("props") or {}
    current = str(props.get(payload.field) or props.get("title") or p.name)
    result = await ai_service.rewrite_page_copy(
        current=current,
        field=payload.field,
        section_label=target.get("label", ""),
        instruction=payload.instruction,
        market=payload.market,
    )
    return {
        "ok": True,
        "section_id": target.get("id"),
        "field": payload.field,
        "before": current,
        "after": result["text"],
        "ai_source": result.get("source", "template"),
    }
