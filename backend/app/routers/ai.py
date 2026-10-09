"""AI 运行时状态与执行日志（P0-REAL-AI-RUNTIME）。

GET /api/ai/status —— 评委可直查的证据面板：
provider / model / runtime / degraded / 调用计数 / 最近错误 / 最近执行日志。
绝不返回 API Key。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import llm, models
from ..database import get_db
from ..security import tenant_scope

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
def ai_status(
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    base = llm.status()
    rows = (
        db.query(models.AIExecution)
        .filter(models.AIExecution.tenant_id == tid)
        .order_by(models.AIExecution.created_at.desc())
        .limit(20)
        .all()
    )
    base["executions"] = [r.to_dict() for r in rows]
    base["execution_count"] = (
        db.query(models.AIExecution).filter(models.AIExecution.tenant_id == tid).count()
    )
    base.pop("api_key", None)
    return base
