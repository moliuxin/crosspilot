"""多站点端点：站点列表 / 创建 / 详情 / 更新 / 删除。

隔离规则（P0-MULTI-SITE 硬约束）：
- 全部端点要求登录（tenant_scope），且只能看到/操作本租户的站点；
- 跨租户访问他人站点一律 404（不泄露存在性）；
- 默认站点（迁移承载旧数据）不可删除。
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import list_sites, require_site
from ..utils import new_id, slugify

router = APIRouter(prefix="/sites", tags=["sites"])


def _with_counts(db: Session, sites: list[models.Site]) -> list[dict]:
    """为站点列表附上页面数 / 询盘数（我的网站卡片展示用）。"""
    if not sites:
        return []
    ids = [s.id for s in sites]
    page_counts = dict(
        db.query(models.Page.site_id, func.count(models.Page.id))
        .filter(models.Page.site_id.in_(ids))
        .group_by(models.Page.site_id)
        .all()
    )
    inquiry_counts = dict(
        db.query(models.Inquiry.site_id, func.count(models.Inquiry.id))
        .filter(models.Inquiry.site_id.in_(ids))
        .group_by(models.Inquiry.site_id)
        .all()
    )
    result = []
    for s in sites:
        s._counts = {
            "pages": page_counts.get(s.id, 0),
            "inquiries": inquiry_counts.get(s.id, 0),
        }
        result.append(s.to_dict())
    return result


def _unique_slug(db: Session, tenant_id: int, name: str, exclude_id: str = "") -> str:
    """租户内唯一 slug。中文名 slugify 后为空 → 回落 site，冲突时追加序号。"""
    base = slugify(name)
    if not base or base == "product":
        base = "site"
    slug = base
    n = 1
    while (
        db.query(models.Site)
        .filter(
            models.Site.tenant_id == tenant_id,
            models.Site.slug == slug,
            models.Site.id != exclude_id,
            models.Site.status != "archived",
        )
        .first()
        is not None
    ):
        n += 1
        slug = f"{base}-{n}"
    return slug


def seed_site_pages(db: Session, tenant_id: int, site: models.Site) -> None:
    """为新站点播种默认页面（与旧租户首次访问 /pages 的播种一致）。

    兼容：若租户已有「无站点归属」的孤儿页面（旧版隐式单站流程产生的），
    直接把它们收编到新站点，避免同一租户出现两套重复页面。
    """
    from .pages import _default_sections

    orphans = (
        db.query(models.Page)
        .filter(models.Page.tenant_id == tenant_id, models.Page.site_id == "")
        .all()
    )
    if orphans:
        for idx, page in enumerate(sorted(orphans, key=lambda p: p.order_index or 0)):
            page.site_id = site.id
            page.order_index = idx
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
                site_id=site.id,
                name=name,
                slug=slug,
                sections=_default_sections() if is_home else _default_sections()[:3],
                is_home=is_home,
                order_index=idx,
                seo_title=f"{name} | {site.name}",
                seo_description=f"{name} page of {site.name}.",
            )
        )


@router.get("")
def list_sites_endpoint(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """本租户的站点列表。新注册账号返回空列表（站点由用户显式创建）。"""
    sites = list_sites(db, tid, include_archived=include_archived)
    return {"ok": True, "sites": _with_counts(db, sites)}


@router.post("", status_code=201)
def create_site(payload: schemas.SiteCreate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """创建站点。同名/同 slug 在租户内不允许重复。"""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="站点名称不能为空")
    # 同名拦截（对用户可读）；slug 由 _unique_slug 保证租户内唯一
    dup = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == tid, models.Site.name == name, models.Site.status != "archived")
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"已存在同名站点「{dup.name}」，请换一个名称")

    site = models.Site(
        id=new_id("site"),
        tenant_id=tid,
        name=name,
        slug=_unique_slug(db, tid, name),
        industry=payload.industry.strip(),
        product_category=payload.product_category.strip(),
        target_markets=list(payload.target_markets or ["en-US"]),
        status="draft",
        template_id=payload.template_id.strip(),
        language=payload.language,
        public_slug=f"s-{tid}-{secrets.token_hex(3)}",
    )
    db.add(site)
    db.flush()

    # 新站点播种默认页面，进入页面编辑器不是一片空白
    seed_site_pages(db, tid, site)

    # 租户现有产品自动关联到新站点（产品是租户级事实，站点复用而非复制）
    products = db.query(models.Product.id).filter(models.Product.tenant_id == tid).all()
    for (product_id,) in products:
        db.add(models.SiteProduct(site_id=site.id, product_id=product_id))

    db.commit()
    db.refresh(site)
    return {"ok": True, "site": site.to_dict()}


@router.get("/{site_id}")
def get_site_endpoint(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    return {"ok": True, "site": _with_counts(db, [site])[0]}


@router.patch("/{site_id}")
def update_site(site_id: str, payload: schemas.SiteUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        name = data["name"].strip()
        if name != site.name:
            dup = (
                db.query(models.Site)
                .filter(
                    models.Site.tenant_id == tid,
                    models.Site.name == name,
                    models.Site.id != site.id,
                    models.Site.status != "archived",
                )
                .first()
            )
            if dup:
                raise HTTPException(status_code=409, detail=f"已存在同名站点「{dup.name}」")
            site.name = name
            site.slug = _unique_slug(db, tid, name, exclude_id=site.id)
    for key in ("industry", "product_category", "template_id"):
        if data.get(key) is not None:
            setattr(site, key, data[key])
    if data.get("target_markets"):
        site.target_markets = list(data["target_markets"])
    if data.get("language"):
        site.language = data["language"]
    if data.get("status"):
        if site.is_default and data["status"] == "archived":
            raise HTTPException(status_code=400, detail="默认站点不可归档（承载存量数据）")
        site.status = data["status"]
        if data["status"] == "published":
            site.publish_count = (site.publish_count or 0) + 1
    db.commit()
    db.refresh(site)
    return {"ok": True, "site": site.to_dict()}


@router.delete("/{site_id}")
def delete_site(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """删除站点：删除其页面与产品关联；询盘是业务记录，保留并解除站点归属。"""
    site = require_site(db, tid, site_id)
    if site.is_default:
        raise HTTPException(status_code=400, detail="默认站点不可删除（承载存量数据）")

    db.query(models.Page).filter(models.Page.site_id == site.id).delete(synchronize_session=False)
    db.query(models.SiteProduct).filter(models.SiteProduct.site_id == site.id).delete(synchronize_session=False)
    for inquiry in db.query(models.Inquiry).filter(models.Inquiry.site_id == site.id).all():
        inquiry.site_id = ""
    for draft in db.query(models.Draft).filter(models.Draft.site_id == site.id).all():
        draft.site_id = ""

    db.delete(site)
    db.commit()
    return {"ok": True, "id": site_id}


# ---------------- 站点 ↔ 产品关联（产品事实租户级，站点复用） ----------------


@router.get("/{site_id}/products")
def list_site_products(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """站点关联的产品列表（产品本体仍是租户级单一事实）。"""
    site = require_site(db, tid, site_id)
    rows = (
        db.query(models.Product, models.SiteProduct.created_at)
        .join(models.SiteProduct, models.SiteProduct.product_id == models.Product.id)
        .filter(models.SiteProduct.site_id == site.id)
        .order_by(models.SiteProduct.created_at.asc())
        .all()
    )
    return {"ok": True, "products": [p.to_dict() for p, _ in rows]}


@router.post("/{site_id}/products", status_code=201)
def link_site_product(
    site_id: str,
    payload: schemas.SiteProductLink,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """把租户产品关联到站点（幂等：重复关联不报错、不重复建行）。"""
    site = require_site(db, tid, site_id)
    product = (
        db.query(models.Product)
        .filter(models.Product.id == payload.product_id, models.Product.tenant_id == tid)
        .first()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="产品不存在")
    exists = (
        db.query(models.SiteProduct)
        .filter(models.SiteProduct.site_id == site.id, models.SiteProduct.product_id == payload.product_id)
        .first()
    )
    if not exists:
        db.add(models.SiteProduct(site_id=site.id, product_id=payload.product_id))
        db.commit()
    return {"ok": True, "site_id": site.id, "product_id": payload.product_id}


@router.delete("/{site_id}/products/{product_id}")
def unlink_site_product(site_id: str, product_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """解除站点与产品的关联（不删除产品本体）。"""
    site = require_site(db, tid, site_id)
    db.query(models.SiteProduct).filter(
        models.SiteProduct.site_id == site.id,
        models.SiteProduct.product_id == product_id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "site_id": site.id, "product_id": product_id}
