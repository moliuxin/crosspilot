"""套餐 / 能力开通申请（ServiceOrder）。

点「立即升级」必须产生一条真实数据库记录，而不是只弹一句
"客服稍后联系你"。审批通过后真实改写 Subscription / Entitlement，
下一请求即刻生效。
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import entitlements, models
from ..database import get_db
from ..security import current_user, tenant_scope
from ..utils import new_id

router = APIRouter(prefix="/service-orders", tags=["service-orders"])


class ServiceOrderCreate(BaseModel):
    plan_id: str = Field(default="", description="目标套餐；与企业能力加购二选一")
    feature_key: str = Field(default="", description="单独开通的能力 feature_key")
    contact: str = Field(default="", max_length=255)
    note: str = Field(default="", max_length=2000)


def _price_of(db: Session, plan_id: str) -> int:
    for p in entitlements.list_plans(db):
        if p["id"] == plan_id:
            return int(p.get("price") or 0)
    return 0


@router.post("", status_code=201)
def create_service_order(
    payload: ServiceOrderCreate,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    user: models.User = Depends(current_user),
):
    if not payload.plan_id and not payload.feature_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "请指定要开通的套餐或能力")
    order = models.ServiceOrder(
        id=new_id("so"),
        tenant_id=tid,
        plan_id=payload.plan_id,
        feature_key=payload.feature_key,
        contact=payload.contact or (user.email or ""),
        note=payload.note,
        amount=_price_of(db, payload.plan_id) if payload.plan_id else 0,
        status="pending",
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return {"ok": True, "order": order.to_dict()}


@router.get("")
def list_service_orders(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    rows = (
        db.query(models.ServiceOrder)
        .filter(models.ServiceOrder.tenant_id == tid)
        .order_by(models.ServiceOrder.created_at.desc())
        .all()
    )
    return {"ok": True, "orders": [r.to_dict() for r in rows]}


@router.post("/{order_id}/approve")
def approve_service_order(
    order_id: str,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    user: models.User = Depends(current_user),
):
    """审批通过：真实写入订阅或能力，权限立即生效。

    平台运营（operator）可代任一租户审批；企业侧本 Demo 允许 owner 自审以
    便于验收（生产应加 operator 校验）。
    """
    order = (
        db.query(models.ServiceOrder)
        .filter(models.ServiceOrder.id == order_id, models.ServiceOrder.tenant_id == tid)
        .first()
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "申请不存在")
    if order.status == "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "该申请已通过")

    if order.plan_id:
        sub = entitlements.ensure_subscription(db, tid, plan_id=order.plan_id)
        sub.plan_id = order.plan_id
        sub.status = "active"
        # 同步展示冗余字段
        tenant = db.get(models.Tenant, tid)
        if tenant:
            tenant.plan = order.plan_id
    if order.feature_key:
        db.add(
            models.Entitlement(
                id=new_id("ent"),
                tenant_id=tid,
                feature_key=order.feature_key,
                source="purchase",
                quota=None,
            )
        )
    order.status = "approved"
    db.commit()
    return {
        "ok": True,
        "order": order.to_dict(),
        "entitlements": entitlements.get_entitlements(db, tid),
    }
