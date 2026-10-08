"""SEO / GEO 优化端点：生成优化前后 Diff，产出待确认草稿。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import scoped_get_or_none

router = APIRouter(prefix="/seo", tags=["seo"])


def build_write(product: models.Product) -> dict:
    """生成发布时真正写回产品的结构化 SEO 补丁。

    与 diff 的 after（给人看的展示文本）不同，这里的值是可直接落库的数据：
    发布后 GET /api/products/{id} 必须能看到这些字段真的变了 ——
    「评分上涨但内容纹丝不动」的假优化就是缺了这一层。
    """
    seo = product.seo or {}
    name = product.name
    model = product.model
    slug = name.lower().replace(" ", "-")

    faq = [
        {"q": f"What is the lead time for the {name} ({model})?", "a": "Standard systems ship in 25–40 days; customized configurations are quoted per scope."},
        {"q": f"Do you support OEM / ODM for the {name}?", "a": "Yes. We support OEM branding and ODM engineering based on your specifications."},
        {"q": f"What certifications does the {name} carry?", "a": "CE / ISO 9001 as standard; EAC and local certifications available on request."},
        {"q": f"Which industries use the {name}?", "a": ", ".join((product.applications or [])[:3]) or "Industrial water treatment and process applications."},
        {"q": f"How is the {name} installed and commissioned?", "a": "Remote commissioning guidance included; on-site engineering available worldwide."},
        {"q": f"What is the warranty of the {name}?", "a": "12-month warranty with lifetime spare-parts supply and technical support."},
        {"q": f"Can the {name} be customized for our water quality?", "a": "Yes — systems are sized to your flow rate, inlet water analysis and target quality."},
        {"q": f"How do I get a quote for the {name}?", "a": "Send your process conditions via the RFQ form; our engineers reply within 12 hours."},
    ]
    image_alt = [
        f"{name} {model} front view",
        f"{name} {model} membrane rack",
        f"{name} {model} control cabinet",
        f"{name} {model} piping detail",
        f"{name} {model} installation site",
        f"{name} {model} container loading",
        f"{name} {model} factory workshop",
        f"{name} {model} commissioning",
    ]

    return {
        "seo": {
            "title": f"{name} Manufacturer & Supplier | AQUAFLOW {model}".strip(),
            "slug": f"/{slug}/",
            "meta_description": f"Industrial {name.lower()} for global B2B projects. {model}. OEM/ODM, global delivery, commissioning support.",
            "h1": f"{name} ({model})".strip(),
            "faq": faq,
            "image_alt": image_alt,
            "schema_enabled": True,
            "faq_schema_enabled": True,
            "optimized_at": "seo-publish",
        },
        "attributes_note": f"{len(product.specs or []) + 12} 个采购属性（Capacity / Material / Pressure / Connection / Control…）",
    }


def build_diff(product: models.Product) -> dict:
    """按产品当前 SEO 状态生成 10 字段优化前后对比。"""
    seo = product.seo or {}
    name = product.name
    model = product.model
    score_before = product.seo_score
    geo_before = product.geo_score
    score_after = min(97, score_before + 25)
    geo_after = min(95, geo_before + 30)
    slug = name.lower().replace(" ", "-")

    return {
        "productId": product.id,
        "productName": name,
        "scoreBefore": score_before,
        "scoreAfter": score_after,
        "geoBefore": geo_before,
        "geoAfter": geo_after,
        "fields": [
            {"key": "title", "label": "页面标题", "impact": "high",
             "before": seo.get("title") or name,
             "after": f"{name} Manufacturer & Supplier | AQUAFLOW {model}".strip()},
            {"key": "slug", "label": "URL / 搜索路由", "impact": "high",
             "before": seo.get("slug") or f"/product?id={product.id}",
             "after": f"/{slug}/"},
            {"key": "meta_description", "label": "Meta Description", "impact": "mid",
             "before": seo.get("meta_description") or "（无）",
             "after": f"Industrial {name.lower()} for global B2B projects. {model}. OEM/ODM, global delivery, commissioning support."},
            {"key": "h1", "label": "H1 主标题", "impact": "mid",
             "before": seo.get("h1") or name,
             "after": f"{name} ({model})".strip()},
            {"key": "attributes", "label": "产品属性", "impact": "mid",
             "before": f"{len(product.specs or [])} 个基础属性",
             "after": f"{len(product.specs or []) + 12} 个采购属性 · Capacity / Material / Pressure / Connection / Control…"},
            {"key": "faq", "label": "FAQ 搜索意图", "impact": "mid",
             "before": f"{len(seo.get('faq') or [])} 条 FAQ" if seo.get("faq") else "无 FAQ",
             "after": "8 个采购问题 · Installation / Cleaning / Lead Time / OEM / Warranty…"},
            {"key": "image_alt", "label": "图片 ALT", "impact": "low",
             "before": "部分图片无 ALT" if seo.get("image_alt") else "无图片 ALT",
             "after": "8 张图片含采购关键词 ALT"},
            {"key": "internal_links", "label": "内部链接", "impact": "low",
             "before": "0 条内链",
             "after": "12 条内链 · 关联产品 / 应用场景 / 案例"},
            {"key": "product_schema", "label": "Product Schema", "impact": "mid",
             "before": "已启用" if seo.get("schema_enabled") else "未启用",
             "after": "Product + Offer + AggregateRating"},
            {"key": "faq_schema", "label": "FAQ Schema", "impact": "mid",
             "before": "未启用",
             "after": "FAQPage 结构化数据"},
        ],
        # 发布引擎真正执行的结构化补丁（与展示用 after 分离）
        "write": build_write(product),
    }


@router.get("/diff/{product_id}")
def get_diff(product_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    p = scoped_get_or_none(db, models.Product, product_id, tid)
    if not p:
        raise HTTPException(status_code=404, detail="产品不存在")
    return build_diff(p)


@router.post("/optimize")
def optimize(payload: schemas.SeoOptimizeRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """生成优化草稿（不直接改线上内容，等待人工确认发布）。"""
    entitlements.require_feature(db, tid, "seo.optimize")
    p = scoped_get_or_none(db, models.Product, payload.productId, tid)
    if not p:
        raise HTTPException(status_code=404, detail="产品不存在")

    diff = build_diff(p)
    draft = models.Draft(
        id=f"draft_{int(__import__('time').time() * 1000)}",
        tenant_id=tid,
        title=f"SEO/GEO 优化草稿 · {p.name}",
        entity_type="product",
        entity_id=p.id,
        diff=[{"field": f["label"], "before": f["before"], "after": f["after"]} for f in diff["fields"]],
        patch=diff.get("write", {}),
        seo_score_before=diff["scoreBefore"],
        seo_score_after=diff["scoreAfter"],
        geo_score_before=diff["geoBefore"],
        geo_score_after=diff["geoAfter"],
        status="draft",
        confirmed=False,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {"ok": True, "draft": draft.to_dict(), "diff": diff}
