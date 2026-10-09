"""Skill Registry(PHASE 1)。

- 注册表是唯一入口:Agent / 生成流水线 / API 全部经 registry.run() 调 Skill
- run() 负责:input schema 校验 → 执行 → SkillRun 落库 → 成功才扣 Credits
"""
from __future__ import annotations

import logging
import time
from typing import Any

from .. import models
from ..database import SessionLocal
from .base import Skill, SkillContext, SkillResult, validate_schema

logger = logging.getLogger(__name__)

_REGISTRY: dict[str, Skill] = {}


def register(skill: Skill) -> Skill:
    if skill.id in _REGISTRY:
        raise ValueError(f"Skill 重复注册:{skill.id}")
    _REGISTRY[skill.id] = skill
    return skill


def all_skills() -> list[Skill]:
    return sorted(_REGISTRY.values(), key=lambda s: s.id)


def get(skill_id: str) -> Skill | None:
    return _REGISTRY.get(skill_id)


async def run(
    skill_id: str,
    context: SkillContext,
    data: dict[str, Any],
    *,
    deduct_credits: bool = True,
    db=None,
) -> tuple[SkillResult | None, dict[str, Any]]:
    """执行并落库。返回 (result, skillrun_dict);失败时 result=None。

    Credits 规则:失败不扣,成功以后才扣(顾问指令 PHASE 1)。
    db:调用方(通常是请求作用域)的 Session;不传则自建(后台流水线场景)。
    """
    from ..utils import new_id

    skill = get(skill_id)
    if skill is None:
        return None, {"error": f"未知 Skill:{skill_id}"}

    errors = validate_schema(data, skill.input_schema)
    run_row = {
        "skill_id": skill.id,
        "skill_version": skill.version,
        "status": "failed",
    }
    if errors:
        run_row["error"] = ";".join(errors)
        _persist(context, data, None, run_row)
        return None, run_row

    started = time.perf_counter()
    try:
        result = await skill.execute(context, data)
    except Exception as exc:  # noqa: BLE001 — Skill 边界,失败要落库而不是炸掉调用方
        result = None
        run_row["error"] = (str(exc).strip() or type(exc).__name__)[:500]
        logger.warning("Skill %s 执行失败:%s", skill.id, run_row["error"])
    latency_ms = int((time.perf_counter() - started) * 1000)

    credits_used = 0
    if result is not None:
        run_row["status"] = "success"
        run_row["ai_source"] = result.ai_source
        run_row["model"] = result.model
        run_row["latency_ms"] = latency_ms
        if deduct_credits and skill.credits > 0:
            credits_used = _deduct_credits(context.tenant_id, skill.credits, db)
            run_row["credits_used"] = credits_used
    else:
        run_row["latency_ms"] = latency_ms

    _persist(context, data, result, run_row, db)
    return result, run_row


def _deduct_credits(tenant_id: int, amount: int, db=None) -> int:
    """成功后扣积分;余额不足时扣到 0 为止(演示环境不因积分中断)。"""
    own = db is None
    if own:
        db = SessionLocal()
    try:
        credit = db.get(models.Credit, tenant_id)
        if credit is None:
            db.add(models.Credit(id=tenant_id, balance=0, total_granted=0))
            db.commit()
            credit = db.get(models.Credit, tenant_id)
        used = min(amount, credit.balance)
        credit.balance -= used
        db.commit()
        return used
    finally:
        if own:
            db.close()


def _persist(context: SkillContext, data: dict[str, Any], result: SkillResult | None, run_row: dict[str, Any], db=None) -> None:
    from ..utils import new_id

    own = db is None
    if own:
        db = SessionLocal()
    try:
        db.add(
            models.SkillRun(
                id=new_id("skr"),
                tenant_id=context.tenant_id,
                site_id=context.site_id or "",
                skill_id=run_row.get("skill_id", ""),
                skill_version=run_row.get("skill_version", ""),
                input_json=data or {},
                output_json=(result.output if result else {}),
                status=run_row.get("status", "failed"),
                ai_source=run_row.get("ai_source", ""),
                model=run_row.get("model", ""),
                latency_ms=run_row.get("latency_ms", 0),
                credits_used=run_row.get("credits_used", 0),
                error=run_row.get("error", ""),
            )
        )
        db.commit()
    except Exception as exc:  # pragma: no cover — 落库失败不阻断业务
        db.rollback()
        logger.warning("SkillRun 落库失败:%s", exc)
    finally:
        if own:
            db.close()
