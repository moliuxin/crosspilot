"""Skill API(PHASE 1):目录 / 详情 / 执行 / 运行历史。全部租户隔离。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..security import tenant_scope
from ..skills import registry
from ..skills.base import SkillContext

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("")
def list_skills():
    return {"skills": [s.meta() for s in registry.all_skills()]}


@router.get("/runs")
def list_runs(limit: int = 20, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    q = (
        db.query(models.SkillRun)
        .filter(models.SkillRun.tenant_id == tid)
        .order_by(models.SkillRun.created_at.desc())
        .limit(min(limit, 100))
    )
    return {"runs": [r.to_dict() for r in q.all()]}


@router.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    row = db.query(models.SkillRun).filter(
        models.SkillRun.id == run_id, models.SkillRun.tenant_id == tid).first()
    if not row:
        raise HTTPException(404, "运行记录不存在")
    return row.to_dict()


@router.get("/{skill_id}")
def skill_detail(skill_id: str):
    s = registry.get(skill_id)
    if not s:
        raise HTTPException(404, "Skill 不存在")
    return s.meta()


class SkillRunRequest(BaseModel):
    input: dict = {}
    site_id: str = ""
    market: str = ""


@router.post("/{skill_id}/run")
async def run_skill(skill_id: str, payload: SkillRunRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    skill = registry.get(skill_id)
    if not skill:
        raise HTTPException(404, "Skill 不存在")
    context = SkillContext(tenant_id=tid, site_id=payload.site_id, market=payload.market)
    result, run_row = await registry.run(skill_id, context, payload.input, db=db)
    if result is None:
        raise HTTPException(422, detail={"message": f"Skill 执行失败:{run_row.get('error', '')}", "run": run_row})
    return {"ok": True, "run": run_row, "output": result.output, "ai_source": result.ai_source, "model": result.model}
