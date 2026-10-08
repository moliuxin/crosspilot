"""额度（Credits）端点：Skill / AI 能力用量与流水。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import singleton
from ..utils import new_id

router = APIRouter(prefix="/credits", tags=["credits"])


def _credit(db: Session, tenant_id: int) -> models.Credit:
    """每租户一份额度账户；首次访问时初始化 1860 初始额度。"""
    c = db.get(models.Credit, tenant_id)
    if not c:
        c = models.Credit(id=tenant_id, balance=1860, total_granted=1860)
        db.add(c)
        db.commit()
        db.refresh(c)
    return c


@router.get("")
def get_credits(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    return _credit(db, tid).to_dict()


@router.get("/logs")
def list_logs(db: Session = Depends(get_db), tid: int = Depends(tenant_scope), limit: int = 20):
    items = (
        db.query(models.CreditLog)
        .filter(models.CreditLog.tenant_id == tid)
        .order_by(models.CreditLog.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [x.to_dict() for x in items]


@router.post("/consume")
def consume(payload: schemas.CreditConsumeRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """消耗额度（使用 Skill）。余额不足返回 402。"""
    c = _credit(db, tid)
    if c.balance < payload.cost:
        raise HTTPException(status_code=402, detail="Credits 余额不足，请充值或升级套餐")

    c.balance -= payload.cost
    log = models.CreditLog(
        id=new_id("cl"),
        tenant_id=tid,
        skill=payload.skill,
        cost=payload.cost,
        balance_after=c.balance,
        note=payload.note,
    )
    db.add(log)
    db.commit()
    db.refresh(c)
    db.refresh(log)
    return {"ok": True, "credits": c.to_dict(), "log": log.to_dict()}


@router.post("/grant")
def grant(payload: schemas.CreditGrantRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """充值额度（套餐购买 / 赠送）。"""
    c = _credit(db, tid)
    c.balance += payload.amount
    c.total_granted += payload.amount
    log = models.CreditLog(
        id=new_id("cl"),
        tenant_id=tid,
        skill=payload.note,
        cost=-payload.amount,
        balance_after=c.balance,
        note=payload.note,
    )
    db.add(log)
    db.commit()
    db.refresh(c)
    db.refresh(log)
    return {"ok": True, "credits": c.to_dict(), "log": log.to_dict()}
