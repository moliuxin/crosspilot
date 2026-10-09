"""Skill 协议与基类(PHASE 1 — Real Skill Engine)。

所有 Skill 遵循同一协议:声明 id/name/version/input_schema/output_schema,
通过 async execute(context, input) 执行。Agent / 生成流水线一律经 registry 调用,
禁止在业务代码里复制 Skill 逻辑。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SkillContext:
    """执行上下文:租户/站点隔离 + 数据访问由调用方注入。"""

    tenant_id: int
    site_id: str = ""
    market: str = ""
    # 由路由层注入的只读数据(如 products / site facts)
    facts: dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillResult:
    """统一返回:输出 + 来源标注 + 质量信息。"""

    output: dict[str, Any]
    ai_source: str = "template"     # glm | template_fallback | template
    model: str = ""
    latency_ms: int = 0
    warnings: list[str] = field(default_factory=list)


class Skill(ABC):
    """Skill 协议。子类必须声明元数据并实现 execute。"""

    id: str = ""
    name: str = ""
    version: str = "1.0.0"
    description: str = ""
    input_schema: dict[str, Any] = {}
    output_schema: dict[str, Any] = {}
    # 成功执行扣除的积分(0 = 免费)
    credits: int = 0

    @abstractmethod
    async def execute(self, context: SkillContext, data: dict[str, Any]) -> SkillResult:
        """执行 Skill。data 必须先通过 input_schema 校验(由 registry 负责)。"""

    def meta(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "credits": self.credits,
        }


def validate_schema(data: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    """轻量校验:required 顶层键必须存在且非空。返回错误列表(空 = 通过)。"""
    errors = []
    for key in schema.get("required", []):
        v = data.get(key)
        if v is None or (isinstance(v, (str, list, dict)) and not v):
            errors.append(f"缺少必填字段:{key}")
    return errors
