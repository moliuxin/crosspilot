"""IndustryIntelligenceSkill(PHASE 2)。

规则库优先(instant_site_ai industry_profiles 思想的三语画像):
别名匹配命中 → 直接输出画像,零 LLM 调用、确定性可测;
置信度不足 → GLM 补全(schema 校验),失败降级 general_b2b。
不虚构 Product Facts。
"""
from __future__ import annotations

from .. import knowledge, llm
from ..prompts import industry_analyzer
from .base import Skill, SkillContext, SkillResult
from .registry import register


class IndustryIntelligenceSkill(Skill):
    id = "industry_intelligence"
    name = "行业情报画像"
    version = "1.0.0"
    description = "产品类别 → 行业画像(决策模型/买家角色/痛点三语/信任要求/布局提示)。规则库优先,GLM 补全。"
    credits = 0
    input_schema = {"required": ["product_category"]}
    output_schema = {
        "required": ["industry", "decision_model", "buyer_roles", "pain_points",
                     "trust_requirements", "content_priorities", "layout_hints",
                     "visual_hints", "image_keywords"],
    }

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        category = (data.get("product_category") or "").strip()
        description = (data.get("product_description") or "").strip()

        matched_id, confidence = knowledge.match_industry(f"{category} {description}")
        if matched_id and confidence >= 0.5:
            prof = knowledge.get_industry(matched_id)
            out = self._shape(prof, category)
            out["confidence"] = confidence
            out["ai_source_detail"] = "rule_library"
            return SkillResult(output=out, ai_source="template")

        # 规则置信度不足 → GLM 补全(schema 校验 + 一次重试在 llm.complete_json 内)
        result = await llm.complete_json(
            industry_analyzer.SYSTEM,
            industry_analyzer.build_user(category, description),
            capability="industry_intelligence",
            schema_keys=["industry"],
        )
        if result and result.get("industry"):
            out = self._shape_llm(result, category)
            out["ai_source_detail"] = "glm"
            out["confidence"] = 0.7
            return SkillResult(output=out, ai_source="glm", model=result.get("_ai_model", ""))

        # 降级:general_b2b 兜底(如实标注)
        prof = knowledge.get_industry("general_b2b")
        out = self._shape(prof, category)
        out["confidence"] = 0.3
        out["ai_source_detail"] = "fallback_general_b2b"
        return SkillResult(output=out, ai_source="template")

    @staticmethod
    def _shape(prof: dict, category: str) -> dict:
        return {
            "industry": prof["industry_id"],
            "industry_label": category or prof["industry_id"],
            "decision_model": prof.get("decision_model", ""),
            "buyer_roles": prof.get("buyer_roles", []),
            "pain_points": [
                {"id": p["id"], "severity": p.get("severity", "mid"),
                 "pain": p.get("pain", {}), "site_answer": p.get("site_answer", "")}
                for p in prof.get("buyer_pain_points", [])
            ],
            "trust_requirements": prof.get("trust_requirements", []),
            "content_priorities": prof.get("content_priorities", []),
            "layout_hints": prof.get("layout_hints", {}),
            "visual_hints": prof.get("visual_hints", {}),
            "marketing_lexicon": prof.get("marketing_lexicon", {}),
            "image_keywords": prof.get("image_keywords", []),
        }

    @staticmethod
    def _shape_llm(result: dict, category: str) -> dict:
        return {
            "industry": result.get("industry", "general_b2b"),
            "industry_label": result.get("industry_label") or category,
            "decision_model": result.get("decision_model", ""),
            "buyer_roles": result.get("buyer_roles", []),
            "pain_points": result.get("pain_points", []),
            "trust_requirements": result.get("trust_requirements", []),
            "content_priorities": result.get("content_priorities", []),
            "layout_hints": result.get("layout_hints", {}),
            "visual_hints": result.get("visual_hints", {}),
            "marketing_lexicon": result.get("marketing_lexicon", {}),
            "image_keywords": result.get("image_keywords", []),
        }


register(IndustryIntelligenceSkill())
