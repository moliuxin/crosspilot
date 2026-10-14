"""Buyer Conversion Readiness API(P0-8 规范 6.4/6.5)。

POST /api/sites/{site_id}/conversion/analyze            分析 → 报告落库
GET  /api/sites/{site_id}/conversion/reports            报告历史(Re-score 对比)
POST /api/sites/{site_id}/conversion/improvement-draft  缺失项 → 改进 Draft(无事实拒绝,不编造)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..security import tenant_scope
from ..services import buyer_conversion_service as bcs
from ..tenancy import require_site

router = APIRouter(prefix="/sites/{site_id}/conversion", tags=["conversion"])


class AnalyzeRequest(BaseModel):
    market: str
    use_semantic: bool = True


def _get_variant(db: Session, site, market: str) -> models.SiteMarketVariant:
    v = (db.query(models.SiteMarketVariant)
         .filter(models.SiteMarketVariant.site_id == site.id,
                 models.SiteMarketVariant.market == market)
         .first())
    if v is None:
        raise HTTPException(status_code=404, detail=f"市场变体 {market} 不存在,请先生成")
    return v


def _products(db: Session, tenant_id: int) -> list:
    return db.query(models.Product).filter(models.Product.tenant_id == tenant_id).all()


@router.post("/analyze", status_code=201)
async def analyze(site_id: str, payload: AnalyzeRequest, db: Session = Depends(get_db),
                  tid: int = Depends(tenant_scope)):
    """五维 Readiness 分析:规则层(确定性)+ 可选 GLM 语义微调,报告落库。"""
    site = require_site(db, tid, site_id)
    variant = _get_variant(db, site, payload.market)
    report = await bcs.analyze_variant(db, tid, site, variant, _products(db, tid),
                                       use_semantic=payload.use_semantic)
    return {"ok": True, "report": report.to_dict()}


@router.get("/reports")
def reports(site_id: str, market: str = "", limit: int = 10,
            db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    q = (db.query(models.BuyerConversionReport)
         .filter(models.BuyerConversionReport.site_id == site.id))
    if market:
        q = q.filter(models.BuyerConversionReport.market == market)
    rows = q.order_by(models.BuyerConversionReport.created_at.desc()).limit(max(1, min(limit, 50))).all()
    return {"ok": True, "reports": [r.to_dict() for r in rows]}


class ImproveRequest(BaseModel):
    market: str
    report_id: str = ""


@router.post("/improvement-draft", status_code=201)
async def improvement_draft(site_id: str, payload: ImproveRequest, db: Session = Depends(get_db),
                            tid: int = Depends(tenant_scope)):
    """按报告缺失项生成改进 Draft(只写真实采购事实;无事实 422 拒绝 —— 不编造)。"""
    site = require_site(db, tid, site_id)
    variant = _get_variant(db, site, payload.market)
    report = None
    if payload.report_id:
        report = db.get(models.BuyerConversionReport, payload.report_id)
        if report is None or report.site_id != site.id:
            raise HTTPException(status_code=404, detail="报告不存在")
    if report is None:
        report = await bcs.analyze_variant(db, tid, site, variant, _products(db, tid))
    draft, applied = bcs.build_improvement_draft(db, tid, site, variant, _products(db, tid), report)
    if draft is None:
        raise HTTPException(status_code=422, detail={
            "message": "无可用的真实采购事实(MOQ/交期/质保等未在产品或区块中填写),拒绝编造;"
                       "请先在产品资料中补充真实采购信息。",
            "missing": report.missing_information,
        })
    return {"ok": True, "draft_id": draft.id, "diff": draft.diff, "applied": applied,
            "market": payload.market,
            "note": "改进草稿已生成;确认发布后请重新分析(Re-score)对比采购信息维度变化。"}
