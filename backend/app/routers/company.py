"""公司信息与身份核验端点。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import current_user, tenant_scope
from ..tenancy import singleton

router = APIRouter(tags=["company"])


def _site(db: Session, tenant_id: int) -> models.SiteState:
    """每租户一份站点状态（主键即 tenant_id）。"""
    return singleton(db, models.SiteState, tenant_id)


@router.get("/company")
def get_company(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    s = _site(db, tid)
    return {
        "id": "company_demo_001",
        "name": s.company_name or "AQUAFLOW Industrial",
        "short": (s.company_name or "AQUAFLOW").split(" ")[0],
        "industry": s.industry or "industrial equipment",
        "industryLabel": s.industry or "工业水处理设备",
        "primary_products": [p.strip() for p in (s.primary_products or "").split(",") if p.strip()],
        "target_markets": s.target_markets or ["en-US"],
        "website": "aquaflow-global.com",
        "contact_name": "",  # 账户系统上线前不虚构联系人名（P1：接真实账户体系）
        "phone": "+86 000 0000 0000",
        "verified": s.verified,
        "plan": s.plan,
    }


@router.post("/company/verify")
def verify(payload: schemas.VerifyRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """企业身份核验（演示环境：任意 4 位以上验证码通过；生产接真实短信服务）。"""
    ok = bool(payload.company) and len(payload.code or "") >= 4
    if ok:
        s = _site(db, tid)
        s.verified = True
        if payload.company:
            s.company_name = payload.company
        db.commit()
    return {"ok": ok, "verified": ok, **payload.model_dump()}
