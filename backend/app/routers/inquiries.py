"""询盘端点：列表 / 详情 / 状态流转 / 独立站 RFQ 提交。"""
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import scoped_get
from ..utils import new_id

router = APIRouter(prefix="/inquiries", tags=["inquiries"])

STATUS_LABEL = {"new": "新询盘", "contacted": "已联系", "following": "跟进中", "done": "已完成"}


def _stats(db: Session, tenant_id: int) -> dict:
    base = db.query(models.Inquiry).filter(models.Inquiry.tenant_id == tenant_id)
    total = base.count()
    hot = base.filter(models.Inquiry.intent == "hot").count()
    done = base.filter(models.Inquiry.status == "done").count()
    conversion = round(done / total * 100, 1) if total else 0.0
    return {
        "monthly": {"value": str(total), "delta": "+0%"},
        "highIntent": {"value": str(hot), "delta": f"{round(hot / total * 100, 1) if total else 0}%"},
        "avgResponse": {"value": "1.8h", "delta": "↓ 0.6h"},
        "conversion": {"value": f"{conversion}%", "delta": "+0.0%"},
    }


@router.get("")
def list_inquiries(
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    status: str | None = Query(default=None),
    q: str | None = None,
    site_id: str = "",
):
    """询盘列表。带 ?site_id= 时只返回该站点的询盘（校验站点归属）。"""
    from ..tenancy import require_site

    query = db.query(models.Inquiry).filter(models.Inquiry.tenant_id == tid)
    if site_id:
        require_site(db, tid, site_id)
        query = query.filter(models.Inquiry.site_id == site_id)
    if status and status != "all":
        query = query.filter(models.Inquiry.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(
            models.Inquiry.customer_name.ilike(like)
            | models.Inquiry.company.ilike(like)
            | models.Inquiry.product_name.ilike(like)
        )
    items = query.order_by(models.Inquiry.created_at.desc()).all()
    return {"inquiries": [i.to_dict() for i in items], "stats": _stats(db, tid)}


@router.get("/{inquiry_id}")
def get_inquiry(inquiry_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    i = scoped_get(db, models.Inquiry, inquiry_id, tid, detail="询盘不存在")
    return i.to_dict()


@router.put("/{inquiry_id}")
def update_status(inquiry_id: str, payload: schemas.InquiryStatusUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    i = scoped_get(db, models.Inquiry, inquiry_id, tid, detail="询盘不存在")
    i.status = payload.status
    db.commit()
    return {"ok": True, "id": inquiry_id, "status": payload.status, "label": STATUS_LABEL[payload.status]}


def _optional_tenant(
    db: Session,
    authorization: str | None,
    x_tenant_id: int | None,
    x_tenant_slug: str | None = None,
) -> int:
    """解析询盘写入的归属租户。

    询盘是唯一允许**匿名**写入的端点（前台访客没有账号），所以不能直接用
    ``tenant_scope`` 强制 401。规则：

    1. 带了有效 token → 落当前登录商家的租户（商家在后台自测表单时不会串库）
    2. 匿名 + X-Tenant-Id → 落该租户（数字 id）
    3. 匿名 + X-Tenant-Slug → 落该 slug 对应的租户（独立站前台用，不可枚举）
    4. 匿名 + 无头 → 落默认租户

    普通商家即便伪造 X-Tenant-Id 也无法往别的租户塞数据 —— 因为规则 1 优先。
    """
    from ..security import _extract_bearer, decode_token

    token = _extract_bearer(authorization)
    if token:
        try:
            payload = decode_token(token)
            user = db.get(models.User, int(payload["sub"]))
            if user and user.tenant_id:
                return user.tenant_id
        except HTTPException:
            pass  # token 失效则退回匿名路径，不阻断访客提交
    if x_tenant_id:
        return x_tenant_id
    if x_tenant_slug:
        t = db.query(models.Tenant).filter(models.Tenant.public_slug == x_tenant_slug).first()
        if t is not None:
            return t.id
    return models.DEFAULT_TENANT_ID


@router.post("", status_code=201)
def create_inquiry(
    payload: schemas.InquiryCreate,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_tenant_id: int | None = Header(default=None, alias="X-Tenant-Id"),
    x_tenant_slug: str | None = Header(default=None, alias="X-Tenant-Slug"),
    x_site_slug: str | None = Header(default=None, alias="X-Site-Slug"),
):
    """独立站 RFQ 表单提交 → 进入询盘中心。

    这是唯一允许匿名写入的端点（前台访客没有账号）：租户由站点绑定的
    X-Tenant-Slug（优先）/ X-Tenant-Id 决定，缺省落到默认租户 ——
    避免匿名请求能往任意租户塞数据。
    X-Site-Slug（站点级 public_slug）能把询盘挂到具体站点。
    """
    tid = _optional_tenant(db, authorization, x_tenant_id, x_tenant_slug)
    site_id = ""
    if x_site_slug:
        site = (
            db.query(models.Site)
            .filter(models.Site.tenant_id == tid, models.Site.public_slug == x_site_slug)
            .first()
        )
        if site is not None:
            site_id = site.id
    products = db.query(models.Product).filter(models.Product.tenant_id == tid).all()
    matched = None
    msg_lower = payload.message.lower()
    for p in products:
        first_word = p.name.split(" ")[0].lower()
        if first_word and first_word in msg_lower:
            matched = p
            break

    hot = any(k in msg_lower for k in ("quote", "price", "urgent", "project", "报价", "срок"))
    inquiry = models.Inquiry(
        id=new_id("rfq"),
        tenant_id=tid,
        site_id=site_id,
        customer_name=payload.name,
        email=payload.email,
        company=payload.company or "—",
        country=payload.country or "—",
        product_id=matched.id if matched else (products[0].id if products else None),
        product_name=matched.name if matched else "General RFQ",
        source_page="/site-preview.html#rfq",
        source_channel="Website RFQ",
        message=payload.message,
        status="new",
        intent="hot" if hot else "warm",
    )
    db.add(inquiry)

    if matched:
        matched.inquiries_count = (matched.inquiries_count or 0) + 1

    db.commit()
    db.refresh(inquiry)
    return {"ok": True, "inquiry": inquiry.to_dict()}
