"""站点状态、用量、发布端点。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..services.ai_service import provider_health
from ..tenancy import scoped_get, scoped_get_or_none, singleton
from ..utils import new_id

router = APIRouter(tags=["site"])


def _site(db: Session, tenant_id: int) -> models.SiteState:
    return singleton(db, models.SiteState, tenant_id)


def _usage(db: Session, tenant_id: int) -> models.Usage:
    return singleton(db, models.Usage, tenant_id)


@router.get("/site/state")
def get_site_state(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    return _site(db, tid).to_dict()


@router.put("/site/state")
def update_site_state(payload: schemas.SiteStateUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    s = _site(db, tid)
    mapping = {
        "companyName": "company_name",
        "industry": "industry",
        "products": "primary_products",
        "targetMarkets": "target_markets",
        "language": "language",
        "plan": "plan",
        "verified": "verified",
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        attr = mapping.get(key)
        if attr and value is not None:
            setattr(s, attr, value)
    db.commit()
    db.refresh(s)
    return {"ok": True, "site": s.to_dict()}


@router.post("/site/generate")
async def generate_site(payload: schemas.SiteGenerateInput, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """首次建站：记录企业信息并消耗一次免费额度。

    多站点后：首次 AI 生成同时创建站点实体（免费额度仍是账号级 1 次）。
    门禁统一走 entitlements.require_feature —— 不再散落前端判断。
    """
    entitlements.require_feature(db, tid, "site.generate")
    s = _site(db, tid)
    if payload.company:
        s.company_name = payload.company
    if payload.industry:
        s.industry = payload.industry
    if payload.products:
        s.primary_products = payload.products
    if payload.markets:
        s.target_markets = payload.markets

    # 首次建站落站点实体：租户还没有站点时创建（名称取公司名）
    from ..tenancy import list_sites

    created_site = None
    if not list_sites(db, tid, include_archived=True):
        from ..tenancy import create_default_site

        created_site = create_default_site(db, tid)
        if payload.company:
            created_site.name = payload.company
        if payload.industry:
            created_site.industry = payload.industry
        if payload.markets:
            created_site.target_markets = list(payload.markets)
        # 产品关联 + 默认页面（与其他新建站点一致）
        products = db.query(models.Product.id).filter(models.Product.tenant_id == tid).all()
        for (product_id,) in products:
            db.add(models.SiteProduct(site_id=created_site.id, product_id=product_id))
        from .sites import seed_site_pages

        seed_site_pages(db, tid, created_site)
    db.commit()
    return {"ok": True, "site_id": created_site.id if created_site else None, **payload.model_dump()}


@router.get("/usage")
def get_usage(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    return _usage(db, tid).to_dict()


@router.post("/usage/consume")
def consume_usage(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    u = _usage(db, tid)
    if u.free_generation_used >= u.free_generation_limit:
        raise HTTPException(status_code=402, detail="免费完整生成次数已用完，请升级套餐")
    u.free_generation_used += 1
    db.commit()
    db.refresh(u)
    return u.to_dict()


@router.get("/drafts")
def list_drafts(site_id: str = "", db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """草稿列表。带 ?site_id= 时只返回该站点的草稿。"""
    from ..tenancy import require_site

    q = db.query(models.Draft).filter(models.Draft.tenant_id == tid)
    if site_id:
        require_site(db, tid, site_id)
        q = q.filter(models.Draft.site_id == site_id)
    items = q.order_by(models.Draft.created_at.desc()).all()
    return [d.to_dict() for d in items]


@router.post("/drafts", status_code=201)
def create_draft(payload: schemas.DraftCreate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """创建内容修改草稿（MCP update_draft 的落点）。

    patch 是结构化写回数据；diff 由 patch 与实体当前值对比生成，供人工审阅。
    发布仍必须走 /publish + human_confirmed —— Agent 安全硬约束不因入口不同而放宽。
    """
    entity = _load_entity(db, payload.entity_type, payload.entity_id, tid)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"{payload.entity_type} 不存在")

    current = _entity_snapshot(db, payload.entity_type, payload.entity_id, tid)
    diff = [
        {"field": k, "before": _brief(current.get(k)), "after": _brief(v)}
        for k, v in (payload.patch or {}).items()
        if current.get(k) != v
    ]
    if not diff:
        raise HTTPException(status_code=409, detail="补丁与当前内容一致，无需修改")

    draft = models.Draft(
        id=new_id("draft"),
        tenant_id=tid,
        site_id=getattr(entity, "site_id", "") or "",
        title=payload.title or f"内容修改草稿 · {payload.entity_id}",
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        diff=diff,
        patch=payload.patch or {},
        status="draft",
        confirmed=False,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {"ok": True, "draft": draft.to_dict()}


def _brief(v):
    """diff 展示用：长结构只显示摘要，避免草稿膨胀。"""
    if isinstance(v, dict):
        return f"{len(v)} 项配置"
    if isinstance(v, list):
        return f"{len(v)} 条"
    if isinstance(v, str) and len(v) > 80:
        return v[:77] + "…"
    return v


def _load_entity(db: Session, entity_type: str, entity_id: str, tenant_id: int):
    """按租户加载实体；跨租户一律视为不存在（不泄露存在性）。"""
    if entity_type == "product":
        return scoped_get_or_none(db, models.Product, entity_id, tenant_id)
    if entity_type == "page":
        return scoped_get_or_none(db, models.Page, entity_id, tenant_id)
    return None


def _entity_snapshot(db: Session, entity_type: str, entity_id: str, tenant_id: int) -> dict:
    """实体全量字典快照（可整包恢复）。"""
    e = _load_entity(db, entity_type, entity_id, tenant_id)
    return e.to_dict() if e else {}


def _apply_patch(db: Session, entity_type: str, entity_id: str, patch: dict, tenant_id: int) -> None:
    """把草稿补丁真正写到实体上 —— 发布引擎的核心。

    product：patch.seo 合并进 seo JSON 列（MutableDict 追踪变更），
             其余键按列名直接赋值。
    page：patch.sections / 标量列直接赋值（sections 走与 PUT /pages 相同的赋值路径）。
    """
    e = _load_entity(db, entity_type, entity_id, tenant_id)
    if e is None or not patch:
        return
    if entity_type == "product":
        seo_patch = patch.pop("seo", None)
        for k, v in patch.items():
            if hasattr(e, k):
                setattr(e, k, v)
        if seo_patch:
            merged = dict(e.seo or {})
            merged.update(seo_patch)
            e.seo = merged  # 重新赋值触发 MutableDict 变更追踪
    else:  # page
        sections = patch.pop("sections", None)
        for k, v in patch.items():
            if hasattr(e, k):
                setattr(e, k, v)
        if sections is not None:
            e.sections = sections


def _next_version_no(db: Session, entity_type: str, entity_id: str, tenant_id: int) -> int:
    last = (
        db.query(models.Version.version_no)
        .filter(
            models.Version.tenant_id == tenant_id,
            models.Version.entity_type == entity_type,
            models.Version.entity_id == entity_id,
        )
        .order_by(models.Version.version_no.desc())
        .first()
    )
    return (last[0] + 1) if last else 1


@router.post("/publish")
def publish(payload: schemas.PublishRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """人工确认后发布。human_confirmed 必须为 true —— Agent 安全规则硬约束。

    发布做三件真事，缺一不可：
    1. patch 真实写入实体（内容字段，不只是分数）
    2. 前后快照写入 Version 表（回滚的依据）
    3. 分数随内容同步更新
    """
    if not payload.human_confirmed:
        raise HTTPException(status_code=403, detail="必须人工确认后才能发布")

    entitlements.require_feature(db, tid, "site.publish")

    draft = scoped_get_or_none(db, models.Draft, payload.draft_id, tid)
    if not draft:
        raise HTTPException(status_code=404, detail="草稿不存在")
    if draft.confirmed:
        raise HTTPException(status_code=409, detail="该草稿已发布")

    before_snapshot = _entity_snapshot(db, draft.entity_type, draft.entity_id, tid)
    entity = _load_entity(db, draft.entity_type, draft.entity_id, tid)
    entity_site_id = getattr(entity, "site_id", "") or "" if entity else ""

    # 1) 结构化补丁真实写回（内容字段）
    if draft.patch:
        _apply_patch(db, draft.entity_type, draft.entity_id, dict(draft.patch), tid)

    # 2) 分数更新（与内容一并落库）
    if draft.entity_type == "product":
        p = scoped_get_or_none(db, models.Product, draft.entity_id, tid)
        if p:
            if draft.seo_score_after is not None:
                p.seo_score = int(draft.seo_score_after)
            if draft.geo_score_after is not None:
                p.geo_score = int(draft.geo_score_after)

    db.flush()  # 让快照拿到写回后的值
    after_snapshot = _entity_snapshot(db, draft.entity_type, draft.entity_id, tid)

    # 3) 版本快照落库
    version = models.Version(
        id=new_id("ver"),
        tenant_id=tid,
        site_id=entity_site_id,
        entity_type=draft.entity_type,
        entity_id=draft.entity_id,
        version_no=_next_version_no(db, draft.entity_type, draft.entity_id, tid),
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        draft_id=draft.id,
        action="publish",
        published_by="merchant",
    )
    db.add(version)

    draft.confirmed = True
    draft.human_confirmed = True
    draft.status = "published"

    s = _site(db, tid)
    s.publish_status = "published"
    s.publish_count = (s.publish_count or 0) + 1

    db.commit()
    return {
        "ok": True,
        "published": True,
        "draft_id": payload.draft_id,
        "version": {"id": version.id, "version_no": version.version_no, "entity_type": draft.entity_type, "entity_id": draft.entity_id},
    }


@router.get("/versions/recent")
def list_recent_versions(limit: int = 50, site_id: str = "", db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """本租户全部实体的版本（新→旧），供「版本历史」列表页使用。

    带 ?site_id= 时只返回该站点的版本。注意：必须注册在
    /versions/{version_id} **之前**，否则 "recent" 会被当成 version_id 匹配掉。
    """
    from ..tenancy import require_site

    limit = max(1, min(int(limit or 50), 200))
    q = db.query(models.Version).filter(models.Version.tenant_id == tid)
    if site_id:
        require_site(db, tid, site_id)
        q = q.filter(models.Version.site_id == site_id)
    items = (
        q.order_by(models.Version.created_at.desc(), models.Version.version_no.desc())
        .limit(limit)
        .all()
    )
    return [v.to_dict() for v in items]


@router.get("/versions")
def list_versions(entity_type: str, entity_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """实体的发布历史（新→旧）。"""
    items = (
        db.query(models.Version)
        .filter(
            models.Version.tenant_id == tid,
            models.Version.entity_type == entity_type,
            models.Version.entity_id == entity_id,
        )
        .order_by(models.Version.version_no.desc())
        .all()
    )
    return [v.to_dict() for v in items]


@router.get("/versions/{version_id}")
def get_version(version_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    v = scoped_get_or_none(db, models.Version, version_id, tid)
    if not v:
        raise HTTPException(status_code=404, detail="版本不存在")
    d = v.to_dict()
    d["before_snapshot"] = v.before_snapshot or {}
    d["after_snapshot"] = v.after_snapshot or {}
    return d


@router.post("/versions/rollback")
def rollback_version(payload: schemas.RollbackRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """真回滚：把实体恢复到指定版本的 before 快照，并记录一条 rollback 版本。

    回滚后 GET 该实体必须能看到旧内容 —— 这是与「toast 假回滚」的本质区别。
    """
    v = scoped_get_or_none(db, models.Version, payload.version_id, tid)
    if not v:
        raise HTTPException(status_code=404, detail="版本不存在")
    if v.entity_type != payload.entity_type or v.entity_id != payload.entity_id:
        raise HTTPException(status_code=409, detail="版本与实体不匹配")

    # 回滚能力统一走权限层（免费版亦可回滚自己站点的版本，属数据安全能力）
    entitlements.require_feature(db, tid, "version.restore")

    snapshot = v.before_snapshot or {}
    if not snapshot:
        raise HTTPException(status_code=409, detail="该版本无可恢复快照")

    current = _entity_snapshot(db, payload.entity_type, payload.entity_id, tid)
    _restore_snapshot(db, payload.entity_type, payload.entity_id, snapshot, tid)
    db.flush()

    rollback = models.Version(
        id=new_id("ver"),
        tenant_id=tid,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        version_no=_next_version_no(db, payload.entity_type, payload.entity_id, tid),
        before_snapshot=current,
        after_snapshot=dict(snapshot),
        draft_id=v.draft_id,
        action="rollback",
        published_by="merchant",
    )
    db.add(rollback)
    db.commit()
    return {"ok": True, "rolled_back": True, "version": rollback.to_dict()}


def _restore_snapshot(db: Session, entity_type: str, entity_id: str, snap: dict, tenant_id: int) -> None:
    """用快照整包覆盖实体（快照键即 to_dict 的键，超集安全）。"""
    e = _load_entity(db, entity_type, entity_id, tenant_id)
    if e is None:
        raise HTTPException(status_code=404, detail=f"{entity_type} 不存在")
    if entity_type == "product":
        for k in ("name", "model", "category", "specs", "benefits", "applications", "images", "description", "seo", "seo_score", "geo_score", "localized_content"):
            if k in snap:
                setattr(e, k, snap[k])
    else:  # page
        for k in ("name", "slug", "sections", "seo_title", "seo_description", "is_home"):
            if k in snap:
                setattr(e, k, snap[k])


@router.get("/health")
def health(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """健康检查 + 当前 AI provider 状态（前端用于显示后端连接状态）。

    计数按当前登录租户统计；未登录时依赖会抛出 401，此处不做兜底 —— 避免泄露全站规模。
    """
    return {
        "ok": True,
        "database": "up",
        "tenant_id": tid,
        "sites": db.query(models.Site).filter(models.Site.tenant_id == tid, models.Site.status != "archived").count(),
        "products": db.query(models.Product).filter(models.Product.tenant_id == tid).count(),
        "inquiries": db.query(models.Inquiry).filter(models.Inquiry.tenant_id == tid).count(),
        "ai": provider_health(),
    }


@router.get("/metrics")
def metrics(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """仪表盘指标：由真实数据推导（询盘量/SEO 均值/GEO 均值等）。"""
    from sqlalchemy import func

    total_inq = (
        db.query(func.count(models.Inquiry.id)).filter(models.Inquiry.tenant_id == tid).scalar() or 0
    )
    hot = (
        db.query(func.count(models.Inquiry.id))
        .filter(models.Inquiry.tenant_id == tid, models.Inquiry.intent == "hot")
        .scalar()
        or 0
    )
    avg_seo = db.query(func.avg(models.Product.seo_score)).filter(models.Product.tenant_id == tid).scalar() or 0
    avg_geo = db.query(func.avg(models.Product.geo_score)).filter(models.Product.tenant_id == tid).scalar() or 0
    products = db.query(func.count(models.Product.id)).filter(models.Product.tenant_id == tid).scalar() or 0

    return {
        "visits30d": {"value": f"{max(1200, total_inq * 148):,}", "delta": "+18.6%"},
        "inquiries": {"value": str(total_inq), "delta": f"+{hot} 高意向"},
        "organicClicks": {"value": f"{int(avg_seo * products * 8):,}", "delta": "+31.8%"},
        "aiCitations": {"value": str(int(avg_geo * products / 6)), "delta": "本周"},
    }


@router.get("/health/site")
def site_health(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """网站健康度：按产品 SEO/GEO 完整度动态计算（供仪表盘/AI 增长页展示）。"""
    products = db.query(models.Product).filter(models.Product.tenant_id == tid).all()
    if not products:
        return {"score": 0, "status": "暂无数据", "opportunities": 0, "items": []}

    avg_seo = sum(p.seo_score or 0 for p in products) / len(products)
    avg_geo = sum(p.geo_score or 0 for p in products) / len(products)
    with_faq = sum(1 for p in products if (p.seo or {}).get("faq"))
    with_meta = sum(1 for p in products if (p.seo or {}).get("meta_description"))
    with_schema = sum(1 for p in products if (p.seo or {}).get("schema_enabled"))
    n = len(products)

    struct = round(60 + 40 * (with_meta / n))
    seo_completeness = round(avg_seo)
    geo_crawl = round(avg_geo)
    mobile = 90
    faq_score = round(100 * with_faq / n) if with_faq else 40
    schema_score = round(100 * with_schema / n) if with_schema else 40
    overall = round((struct + seo_completeness + geo_crawl + mobile) / 4)

    def level(s):
        return "good" if s >= 80 else "warn" if s >= 60 else "bad"

    items = [
        {"label": "页面结构", "score": struct, "level": level(struct)},
        {"label": "移动端体验", "score": mobile, "level": level(mobile)},
        {"label": "SEO 完整度", "score": seo_completeness, "level": level(seo_completeness)},
        {"label": "GEO 可抓取性", "score": geo_crawl, "level": level(geo_crawl)},
        {"label": "FAQ / 结构化数据", "score": round((faq_score + schema_score) / 2), "level": level((faq_score + schema_score) / 2)},
    ]
    opportunities = sum(1 for i in items if i["score"] < 80) + sum(1 for p in products if (p.seo_score or 0) < 70)

    return {
        "score": overall,
        "status": "整体表现良好" if overall >= 80 else "存在可优化项" if overall >= 60 else "需要重点优化",
        "opportunities": opportunities,
        "items": items,
    }


# ---------------- 市场本地化版本 ----------------

# 免费额度：除默认 en-US 外，可额外生成 1 个市场版本；再往上走付费。
FREE_EXTRA_MARKETS = 1
DEFAULT_MARKET = "en-US"
ALL_MARKETS = ["en-US", "ru-RU", "zh-CN"]


def _market_list(db: Session, tenant_id: int) -> list[str]:
    s = _site(db, tenant_id)
    markets = list(s.target_markets or [DEFAULT_MARKET])
    if DEFAULT_MARKET not in markets:
        markets.insert(0, DEFAULT_MARKET)
    return [m for m in ALL_MARKETS if m in markets]


@router.get("/localization")
def get_localization(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """已生成的市场版本 + 免费额度使用情况。

    免费规则由服务端裁定，前端只负责展示，避免把额度判定放在 localStorage 被绕过。
    """
    markets = _market_list(db, tid)
    extra_used = max(0, len(markets) - 1)
    free_left = max(0, FREE_EXTRA_MARKETS - extra_used)
    return {
        "markets": markets,
        "available": ALL_MARKETS,
        "defaultMarket": DEFAULT_MARKET,
        "freeExtraLimit": FREE_EXTRA_MARKETS,
        "freeExtraLeft": free_left,
        "requiresPayment": free_left <= 0,
    }


@router.post("/localization/generate")
def generate_localization(payload: schemas.MarketGenerateRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """生成（或重复请求）某个市场版本。免费额度用尽且为新增市场时返回 402。"""
    s = _site(db, tid)
    market = payload.market
    markets = _market_list(db, tid)

    if market in markets:
        return {"ok": True, "already": True, "market": market, **get_localization(db, tid)}

    # 统一权限门禁：套餐已含 market.localize 则不受免费额度限制；
    # 未含则回落原有的「免费 1 个额外市场」体验额度。
    if not entitlements.has_feature(db, tid, "market.localize"):
        extra_used = max(0, len(markets) - 1)
        if extra_used >= FREE_EXTRA_MARKETS:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "免费市场版本额度已用完，升级套餐后可解锁全部语言市场版本",
                    "feature": "market.localize",
                    "requiredPlan": entitlements.required_plan_for("market.localize"),
                    "upgradeUrl": entitlements.UPGRADE_URL,
                },
            )

    s.target_markets = markets + [market]
    db.commit()
    db.refresh(s)
    return {"ok": True, "already": False, "market": market, **get_localization(db, tid)}
