"""付费权限端点：一次性下发租户的全量权限，供前端收口所有硬编码判断。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import entitlements
from ..database import get_db
from ..security import tenant_scope

router = APIRouter(prefix="/entitlements", tags=["entitlements"])


@router.get("")
def get_entitlements(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """返回 {plan, features, limits, quotas, plans, upgradeUrl}。

    前端 AppContext 启动后调用一次，20 处散落的付费判断统一改用
    ``entitlements.features[key]``，不再各自写死。
    """
    return {"ok": True, **entitlements.get_entitlements(db, tid)}
