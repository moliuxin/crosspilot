"""独立站前台公开只读端点（无认证）。

背景：独立站前台（site-preview.html）是给海外买家看的，不能要求登录。
但此前 ``getPages()/getProducts()`` 都挂在 ``tenant_scope`` 下，匿名必然 401，
前端只能回落到 mock —— 结果**所有企业都显示同一套 AQUAFLOW 内容**。

这里提供一条匿名可读的、按租户渲染的接口，并严守两条边界：

1. **只能读到已发布站点**（``publish_status == "published"``），未发布 → 404，
   防止通过猜 slug 读到未上线内容；
2. **字段白名单**：绝不返回任何询盘 / 用户 / 额度 / 草稿 / 版本 / 内部评分
   （seo_score、geo_score、inquiries_count 均不下发）。
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/public", tags=["public"])

# 对外可见的字段白名单 —— 新增字段必须显式加入，避免误泄
_PUBLIC_PRODUCT_FIELDS = (
    "id",
    "name",
    "model",
    "category",
    "specs",
    "benefits",
    "applications",
    "images",
    "description",
    "seo",
    "localized_content",
)


def _public_product(p: models.Product) -> dict:
    d = {k: getattr(p, k, None) for k in _PUBLIC_PRODUCT_FIELDS}
    # JSON 列可能为 None，统一成前端好处理的空值
    for k in ("specs", "benefits", "applications", "images"):
        d[k] = d[k] or []
    for k in ("seo", "localized_content"):
        d[k] = d[k] or {}
    d["description"] = d["description"] or ""
    return d


def _resolve_public_tenant(db: Session, key: str) -> models.Tenant | None:
    """支持 slug（优先）或数字 id。"""
    key = (key or "").strip()
    if not key:
        return None
    t = db.query(models.Tenant).filter(models.Tenant.public_slug == key).first()
    if t is not None:
        return t
    if key.isdigit():
        return db.get(models.Tenant, int(key))
    return None


@router.get("/site")
def get_public_site(tenant: str = "", site: str = "", db: Session = Depends(get_db)):
    """匿名读取已发布站点（品牌 / 联系 / 导航 / 首页区块 / 产品）。

    多站点后支持两种寻址：
    - ``?site=<site.public_slug>`` —— 站点级（多站点主路径），返回该站点页面；
    - ``?tenant=<slug|id>`` —— 旧版租户级（兼容），返回租户默认站点的页面。
    """
    if site:
        s_obj = db.query(models.Site).filter(models.Site.public_slug == site).first()
        if s_obj is None or (s_obj.status or "") != "published":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "站点不存在或尚未发布")
        t = db.get(models.Tenant, s_obj.tenant_id)
        if t is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "站点不存在")
        return _public_site_payload(db, t, s_obj)

    t = _resolve_public_tenant(db, tenant)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "站点不存在")

    s = db.get(models.SiteState, t.id)
    if s is None or (s.publish_status or "") != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "站点尚未发布")

    # 旧版租户级寻址回落到默认站点（迁移前的行为等价）
    site_obj = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == t.id, models.Site.is_default.is_(True))
        .first()
    )
    return _public_site_payload(db, t, site_obj)


def _public_site_payload(db: Session, t: models.Tenant, site_obj: models.Site | None) -> dict:
    """组装对外站点数据。site_obj 为空时（异常数据）回落租户级页面。"""
    s = db.get(models.SiteState, t.id)
    if s is None:
        s = models.SiteState(id=t.id)

    pages_q = db.query(models.Page).filter(models.Page.tenant_id == t.id)
    if site_obj is not None:
        pages_q = pages_q.filter(models.Page.site_id == site_obj.id)
    pages = pages_q.order_by(models.Page.order_index).all()
    home = next((p for p in pages if p.is_home), pages[0] if pages else None)

    if site_obj is not None:
        products = (
            db.query(models.Product)
            .join(models.SiteProduct, models.SiteProduct.product_id == models.Product.id)
            .filter(models.SiteProduct.site_id == site_obj.id)
            .order_by(models.Product.created_at)
            .limit(50)
            .all()
        )
    else:
        products = (
            db.query(models.Product)
            .filter(models.Product.tenant_id == t.id)
            .order_by(models.Product.created_at)
            .limit(50)
            .all()
        )

    brand_name = (site_obj.name if site_obj else "") or s.company_name or t.name
    industry = (site_obj.industry if site_obj else "") or s.industry or t.industry
    markets = (site_obj.target_markets if site_obj else None) or s.target_markets or ["en-US"]
    language = (site_obj.language if site_obj else "") or s.language

    return {
        "ok": True,
        "tenant": {
            "slug": t.public_slug,
            "name": t.name,
            "industry": t.industry,
        },
        "site": (
            {
                "id": site_obj.id,
                "slug": site_obj.public_slug,
                "name": site_obj.name,
                "industry": site_obj.industry,
                "product_category": site_obj.product_category,
                "target_markets": site_obj.target_markets or ["en-US"],
            }
            if site_obj
            else None
        ),
        "brand": {
            "name": brand_name,
            "industry": industry,
            "products": s.primary_products or "",
        },
        "contact": {
            # 仅公开联系方式；商家联系方式来自 SiteState（无则为空，前端用模板兜底）
            "companyName": s.company_name or t.name,
        },
        "markets": markets,
        "language": language,
        "pages": [
            {
                "id": p.id,
                "name": p.name,
                "slug": p.slug,
                "is_home": p.is_home,
                "seo_title": p.seo_title,
                "seo_description": p.seo_description,
                "sections": p.sections or [],
            }
            for p in pages
        ],
        "home": (
            {
                "id": home.id,
                "name": home.name,
                "sections": home.sections or [],
                "seo_title": home.seo_title,
                "seo_description": home.seo_description,
            }
            if home
            else None
        ),
        "products": [_public_product(p) for p in products],
    }
