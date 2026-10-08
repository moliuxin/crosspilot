"""产品相关端点：增删改查 + AI 内容生成。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..services import ai_service, xlsx_service
from ..tenancy import scoped_get
from ..utils import new_id, slugify

router = APIRouter(prefix="/products", tags=["products"])


@router.get("")
def list_products(
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    q: str | None = Query(default=None, description="按名称/型号/分类搜索"),
    category: str | None = None,
):
    query = db.query(models.Product).filter(models.Product.tenant_id == tid)
    if category:
        query = query.filter(models.Product.category == category)
    if q:
        like = f"%{q}%"
        query = query.filter(
            models.Product.name.ilike(like)
            | models.Product.model.ilike(like)
            | models.Product.category.ilike(like)
        )
    return [p.to_dict() for p in query.order_by(models.Product.created_at.desc()).all()]


@router.get("/{product_id}")
def get_product(product_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    p = scoped_get(db, models.Product, product_id, tid, detail="产品不存在")
    return p.to_dict()


@router.post("", status_code=201)
async def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """新增产品：调用 AI 生成三语言内容，随后落库。"""
    specs = [s.model_dump() for s in payload.specs]
    content = await ai_service.generate_product_content(
        name=payload.name, model=payload.model or "AF-NEW", specs=specs, applications=payload.applications
    )

    en = content.get("en", {})
    seo = payload.seo.model_dump() if payload.seo else {
        "title": en.get("title", payload.name),
        "slug": f"/{slugify(payload.name)}/",
        "meta_description": en.get("description", ""),
        "h1": payload.name,
        "faq": en.get("faq", []),
        "image_alt": en.get("imageAlt", []),
        "schema_enabled": False,
    }

    product = models.Product(
        id=new_id("prod"),
        tenant_id=tid,
        name=payload.name,
        model=payload.model,
        category=payload.category or "General",
        specs=specs,
        benefits=payload.benefits or en.get("benefits", []),
        applications=payload.applications,
        images=payload.images,
        description=payload.description or en.get("description", ""),
        seo=seo,
        seo_score=60,
        geo_score=42,
        localized_content=payload.localized_content or {"en": content},
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return {"ok": True, "product": product.to_dict(), "ai_source": content.get("_source", "template")}


async def _create_one(item, db: Session, tenant_id: int) -> models.Product:
    """把一条导入项变成真实产品（AI 生成内容 + 落库）。批量导入/Excel 导入共用。"""
    specs = []
    for raw in item.specs or []:
        if ":" in raw:
            k, v = raw.split(":", 1)
            specs.append({"key": k.strip(), "value": v.strip()})
        elif raw.strip():
            specs.append({"key": raw.strip(), "value": ""})

    content = await ai_service.generate_product_content(
        name=item.name, model=item.model or "AF-NEW", specs=specs, applications=item.applications
    )
    en = content.get("en", {})
    product = models.Product(
        id=new_id("prod"),
        tenant_id=tenant_id,
        name=item.name,
        model=item.model,
        category=item.category or "General",
        specs=specs,
        benefits=en.get("benefits", []),
        applications=item.applications,
        images=[],
        description=en.get("description", ""),
        seo={
            "title": en.get("title", item.name),
            "slug": f"/{slugify(item.name)}/",
            "meta_description": en.get("description", ""),
            "h1": item.name,
            "faq": en.get("faq", []),
            "image_alt": en.get("imageAlt", []),
            "schema_enabled": False,
        },
        seo_score=60,
        geo_score=42,
        localized_content={"en": content},
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


async def _import_items(items, db: Session, tenant_id: int) -> dict:
    """逐条导入，单行失败不回滚整批。"""
    created, failed = [], []
    for idx, item in enumerate(items):
        try:
            product = await _create_one(item, db, tenant_id)
            created.append({"index": idx + 1, "name": item.name, "id": product.id})
        except Exception as exc:  # noqa: BLE001 — 逐行容错，不因单行失败中断整批
            db.rollback()
            failed.append({"index": idx + 1, "name": item.name, "error": str(exc)})

    return {
        "ok": True,
        "created": created,
        "failed": failed,
        "created_count": len(created),
        "failed_count": len(failed),
    }


@router.post("/bulk-import")
async def bulk_import(payload: schemas.BulkImportRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """批量导入产品：逐条 AI 生成内容后落库，返回逐行结果。"""
    return await _import_items(payload.items, db, tid)


@router.post("/parse-xlsx")
async def parse_xlsx(payload: schemas.XlsxParseRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """解析 .xlsx 为待导入产品清单。

    - `commit=false`（默认）：只解析并预览，不落库，供前端确认。
    - `commit=true`：解析后立即逐行导入（可在 `items` 传用户确认/编辑后的清单）。
    """
    try:
        parsed = xlsx_service.parse_xlsx_base64(payload.content_base64)
    except xlsx_service.XlsxParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = {
        "ok": True,
        "filename": payload.filename,
        "sheet": parsed.get("sheet", ""),
        "items": parsed["items"],
        "errors": parsed["errors"],
        "skippedHeader": parsed["skippedHeader"],
        "count": len(parsed["items"]),
    }

    if not payload.commit:
        return result

    # commit 模式：优先用前端回传的（可能被人工编辑过的）items
    raw_items = payload.items if payload.items else [schemas.BulkImportItem(**i) for i in parsed["items"]]
    if not raw_items:
        raise HTTPException(status_code=400, detail="没有可导入的产品行")

    imported = await _import_items(raw_items, db, tid)
    return {**result, **imported}


@router.put("/{product_id}")
def update_product(product_id: str, payload: schemas.ProductUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    p = scoped_get(db, models.Product, product_id, tid, detail="产品不存在")

    data = payload.model_dump(exclude_unset=True)
    if "seo" in data and data["seo"] is not None:
        data["seo"] = payload.seo.model_dump()
    if "specs" in data and data["specs"] is not None:
        data["specs"] = [s.model_dump() if hasattr(s, "model_dump") else s for s in payload.specs]

    for k, v in data.items():
        if v is not None and hasattr(p, k):
            setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return {"ok": True, "id": product_id, "product": p.to_dict()}


@router.delete("/{product_id}")
def delete_product(product_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    p = scoped_get(db, models.Product, product_id, tid, detail="产品不存在")
    db.delete(p)
    db.commit()
    return {"ok": True, "id": product_id}
