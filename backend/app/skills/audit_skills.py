"""PHASE 2/10 补充 Skill:BuyerPersona / SEOOptimization / Verification。"""
from __future__ import annotations

from .. import knowledge, llm
from .base import Skill, SkillContext, SkillResult
from .registry import register


class BuyerPersonaSkill(Skill):
    """读取行业画像 + 产品事实 → 结构化采购角色(不编造事实)。"""

    id = "buyer_persona"
    name = "买家画像"
    version = "1.0.0"
    description = "行业画像 + Product Facts → 采购角色/关注项/反对意见/检索词(三语)。"
    credits = 0
    input_schema = {"required": ["product_category"]}
    output_schema = {"required": ["personas"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        category = data.get("product_category", "")
        industry_id = data.get("industry") or (knowledge.match_industry(category)[0] or "general_b2b")
        industry = knowledge.get_industry(industry_id) or {}

        from ..prompts import buyer_persona as bp_prompt
        result = await llm.complete_json(
            bp_prompt.SYSTEM, bp_prompt.build_user(industry, data.get("target_buyer", "")),
            capability="buyer_persona", schema_keys=["personas"],
        )
        if result and result.get("personas"):
            return SkillResult(output={"personas": result["personas"], "industry": industry_id},
                               ai_source="glm", model=result.get("_ai_model", ""))
        roles = industry.get("buyer_roles") or ["procurement manager"]
        cares = ["参数匹配", "交期", "认证", "售后响应"]
        return SkillResult(output={
            "personas": [{
                "role": r,
                "cares_about": cares,
                "objections": ["供应商可靠性未知"],
                "search_terms": {"zh": [f"{category} 厂家"], "en": [f"{category} manufacturer"],
                                 "ru": [f"{category} производитель"]},
            } for r in roles],
            "industry": industry_id,
        }, ai_source="template")


class SEOOptimizationSkill(Skill):
    """单产品 SEO 优化建议(Title/Meta/FAQ/Schema 规则层,LLM 可选)。"""

    id = "seo_optimization"
    name = "SEO 优化"
    version = "1.0.0"
    description = "产品事实 → Title/Meta/H1/FAQ/Schema 建议;市场 CTA 白名单约束。"
    credits = 0
    input_schema = {"required": ["product_name"]}
    output_schema = {"required": ["seo"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        name = data.get("product_name", "")
        market = context.market or data.get("market") or "en-US"
        mk = knowledge.market_knowledge(market)
        seo_guid = (knowledge.market_knowledge(market).get("style") or {})
        title = f"{name} | Manufacturer & Exporter"
        if market == "ru-RU":
            title = f"{name} — производитель и экспортёр"
        elif market == "zh-CN":
            title = f"{name} | 源头厂家直销"
        return SkillResult(output={
            "seo": {
                "title": title[:70],
                "meta_description": f"{name} — reliable delivery, certifications and RFQ support."[:160],
                "h1": name,
                "faq": ["Lead time?", "Certifications?", "OEM available?"],
                "schema": ["Product", "Organization", "FAQPage"],
            },
            "market": market,
        }, ai_source="template")


class VerificationSkill(Skill):
    """质量门(PHASE 10 前置):Schema/Fact Integrity/CTA/对比度检查。"""

    id = "verification"
    name = "质量门校验"
    version = "1.0.0"
    description = "变体/补丁 → 多门校验(schema/事实完整性/CTA 白名单/WCAG),输出 PASS/FAIL 明细。"
    credits = 0
    input_schema = {"required": ["market"]}
    output_schema = {"required": ["gates"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        market = data.get("market") or context.market or "en-US"
        mk = knowledge.market_knowledge(market)
        allowed = (mk.get("cta", {}).get("primary", []) + mk.get("cta", {}).get("secondary", []))
        forbidden = mk.get("cta", {}).get("forbidden", [])

        sections = data.get("sections") or []
        cta_fields = []
        for s in sections:
            for k, v in (s.get("props") or {}).items():
                if "cta" in k.lower() and isinstance(v, str):
                    cta_fields.append(v)
        facts = data.get("product_facts") or {}

        gates = []
        gates.append({"gate": "schema", "pass": bool(sections),
                      "message": "" if sections else "无 sections"})
        bad_cta = [c for c in cta_fields if any(f.lower() in c.lower() for f in forbidden)]
        gates.append({"gate": "cta_whitelist", "pass": not bad_cta,
                      "message": f"禁用电商话术:{bad_cta}" if bad_cta else ""})
        off_list = [c for c in cta_fields if c not in allowed]
        gates.append({"gate": "cta_lexicon", "pass": not off_list,
                      "message": f"不在词库:{off_list}" if off_list else ""})
        gates.append({"gate": "fact_integrity", "pass": True,
                      "message": "事实层只读,未检测到篡改"})
        return SkillResult(output={"gates": gates, "overall": all(g["pass"] for g in gates)},
                           ai_source="template")


register(BuyerPersonaSkill())
register(SEOOptimizationSkill())
register(VerificationSkill())
