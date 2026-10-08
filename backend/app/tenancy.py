"""租户隔离辅助：让「取实体」自动带租户校验，避免逐处手写过滤漏掉。

用法：
    from ..tenancy import scoped_get, scoped_query

    @router.get("/{id}")
    def get_one(id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
        return scoped_get(db, models.Product, id, tid).to_dict()
"""
from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Query, Session

from . import models

T = TypeVar("T")


def scoped_query(db: Session, model: type[T], tenant_id: int, **filters) -> Query:
    """按租户过滤的查询起点。"""
    q = db.query(model)
    if hasattr(model, "tenant_id"):
        q = q.filter(model.tenant_id == tenant_id)
    for k, v in filters.items():
        q = q.filter(getattr(model, k) == v)
    return q


def scoped_get(db: Session, model: type[T], pk: Any, tenant_id: int, *, detail: str = "资源不存在", soft: bool = False):
    """按主键取实体并校验归属；不属于当前租户 → 404（不泄露存在性）。

    ``soft=True`` 时改为返回 None（调用方自行决定报错文案），
    适合「先探测再决定」的场景，如 Agent 里「找不到就跳过」。
    """
    obj = scoped_get_or_none(db, model, pk, tenant_id)
    if obj is None and not soft:
        raise HTTPException(status_code=404, detail=detail)
    return obj


def scoped_get_or_none(db: Session, model: type[T], pk: Any, tenant_id: int) -> T | None:
    """按主键取实体；不存在或不属于当前租户一律返回 None。"""
    if pk is None:
        return None
    obj = db.get(model, pk)
    if obj is None:
        return None
    if hasattr(obj, "tenant_id") and obj.tenant_id != tenant_id:
        return None
    return obj


def singleton(db: Session, model: type[T], tenant_id: int) -> T:
    """取「每租户一行」的单例行（site_state / usage / credits），不存在则创建。"""
    obj = db.get(model, tenant_id)
    if obj is None:
        try:
            obj = model(id=tenant_id)
        except TypeError:  # pragma: no cover - 非单例模型的误用
            raise HTTPException(status_code=500, detail=f"{model.__name__} 不是每租户单例表") from None
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


# ---------------- 多站点作用域 ----------------

def list_sites(db: Session, tenant_id: int, *, include_archived: bool = False):
    """租户的全部站点（按创建时间升序，默认站点排最前）。"""
    q = db.query(models.Site).filter(models.Site.tenant_id == tenant_id)
    if not include_archived:
        q = q.filter(models.Site.status != "archived")
    return q.order_by(models.Site.created_at.asc(), models.Site.id.asc()).all()


def default_site(db: Session, tenant_id: int) -> models.Site:
    """租户的默认站点（迁移兼容层）；不存在时创建一个。

    多站点改造前的所有数据都归属默认站点 —— 旧租户第一次访问
    站点列表时用它完成「隐式单站 → 多站点」的平滑过渡。
    """
    site = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == tenant_id, models.Site.is_default.is_(True))
        .first()
    )
    if site is None:
        site = create_default_site(db, tenant_id)
    return site


def create_default_site(db: Session, tenant_id: int) -> models.Site:
    """为租户创建默认站点（名称取自 SiteState / Tenant，旧数据全部归入它）。"""
    import secrets

    from .utils import new_id, slugify

    tenant = db.get(models.Tenant, tenant_id)
    state = db.get(models.SiteState, tenant_id)
    name = (getattr(state, "company_name", "") or "").strip() or (tenant.name if tenant else "") or "默认站点"
    # 中文名 slugify 后为空（回落 "product"），默认站点统一用 main 占位更直观
    slug = slugify(name)
    if not slug or slug == "product":
        slug = "main"
    site = models.Site(
        id=new_id("site"),
        tenant_id=tenant_id,
        name=name,
        slug=slug,
        industry=(getattr(state, "industry", "") or (tenant.industry if tenant else "") or ""),
        target_markets=list(getattr(state, "target_markets", None) or ["en-US"]),
        status=(getattr(state, "publish_status", None) or "draft"),
        is_default=True,
        public_slug=f"s-{tenant_id}-{secrets.token_hex(3)}",
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


def get_site(db: Session, tenant_id: int, site_id: str) -> models.Site | None:
    """取租户的某个站点；不存在或跨租户一律 None（不泄露存在性）。"""
    if not site_id:
        return None
    site = db.get(models.Site, site_id)
    if site is None or site.tenant_id != tenant_id:
        return None
    return site


def require_site(db: Session, tenant_id: int, site_id: str) -> models.Site:
    """取站点，不存在/跨租户 → 404。站点级数据 API 的统一入口校验。"""
    site = get_site(db, tenant_id, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="站点不存在")
    return site
