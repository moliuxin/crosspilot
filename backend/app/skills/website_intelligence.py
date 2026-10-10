"""WebsiteIntelligenceSkill(PHASE 第二批):完整情报流程包装为 Skill。"""
from __future__ import annotations

from ..database import SessionLocal
from ..utils import new_id
from .base import Skill, SkillContext, SkillResult
from .registry import register


class WebsiteIntelligenceSkill(Skill):
    id = "website_intelligence"
    name = "Website Intelligence"
    version = "1.0.0"
    description = "分析目标行业公开网站的结构化设计特征(不复制内容),生成 Market Design Profile。"
    credits = 0
    input_schema = {"required": ["product_category", "market"]}
    output_schema = {"required": ["research_summary"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        from ..website_intelligence import service as wi_service
        from .. import knowledge as kb

        category = data.get("product_category", "")
        market = data.get("market", "en-US")
        reference_urls = data.get("reference_urls") or []

        industry_id = data.get("industry") or (kb.match_industry(category)[0] or "general_b2b")

        db = SessionLocal()
        try:
            result = await wi_service.run_research(
                db, tenant_id=context.tenant_id,
                industry=industry_id, product_category=category, market=market,
                buyer_roles=data.get("buyer_roles"),
                reference_urls=reference_urls if reference_urls else None,
                site_id=context.site_id,
            )
        finally:
            db.close()

        profile = result.get("profile")
        output = {
            "research_summary": {
                "sources_discovered": result["run"]["sources_discovered"],
                "sources_successful": result["run"]["sources_successful"],
                "latency_ms": result["run"]["latency_ms"],
            },
            "source_count": result["run"]["sources_successful"],
            "market_design_profile": profile,
            "confidence": profile.get("confidence", {}) if profile else {"level": "low", "note": "No profile generated"},
        }

        if profile:
            output.update({
                "recommended_layout": profile.get("layout_patterns", {}),
                "recommended_cta": profile.get("cta_patterns", {}),
                "recommended_visual_style": profile.get("visual_patterns", {}),
                "recommended_trust_signals": profile.get("trust_patterns", {}),
            })

        return SkillResult(output=output, ai_source="rule_engine")


register(WebsiteIntelligenceSkill())
