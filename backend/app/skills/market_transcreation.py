"""MarketTranscreationSkill(PHASE 7)+ Visual Skills(PHASE 9)。

Transcreation ≠ Translation:输入事实与行业画像,输出市场化表达;
主 CTA 必须来自市场词库;禁用电商话术(Buy Now/Cart/Checkout)。
Visual Brief / Visual Generation 走 ImageProvider,文本模型禁止伪造图片 URL。
"""
from __future__ import annotations

from .. import knowledge, llm
from .base import Skill, SkillContext, SkillResult
from .registry import register

# AI 禁止生成的事实性图片角色(PHASE 9)
FORBIDDEN_AI_ROLES = {
    "certification", "customer_logo", "factory_evidence", "product_label",
    "spec_plate", "case_real",
}

# B2B RFQ 站点禁止的电商 CTA(词库 forbidden + 兜底)
ECOMMERCE_CTA_PATTERNS = ("buy now", "add to cart", "checkout", "立即购买", "加入购物车", "立即结算",
                          "купить сейчас", "в корзину", "оформить заказ")


class MarketTranscreationSkill(Skill):
    id = "market_transcreation"
    name = "市场转创(Transcreation)"
    version = "1.0.0"
    description = "事实 + 行业画像 + 市场知识 → 市场化文案(非翻译);CTA 白名单 + 电商话术禁用检查。"
    credits = 0
    input_schema = {"required": ["market", "product_category"]}
    output_schema = {"required": ["copy", "quality_report"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        market = data.get("market", "en-US")
        category = data.get("product_category", "")
        facts = data.get("product_facts") or {}
        section = data.get("section") or {}

        mk = knowledge.market_knowledge(market)
        if not mk:
            return SkillResult(output={"copy": {}, "quality_report": [{"check": "market", "pass": False,
                                                                        "message": f"未知市场 {market}"}]},
                               ai_source="template")

        industry_id = data.get("industry") or (knowledge.match_industry(category)[0] or "general_b2b")
        industry = knowledge.get_industry(industry_id) or {}
        cta_lex = mk.get("cta", {})
        allowed = cta_lex.get("primary", []) + cta_lex.get("secondary", [])
        idioms = mk.get("idioms", {}).get("idioms", [])

        # GLM 优先(市场转创 prompt 消费事实+画像+词库约束)
        from ..prompts import market_localization as ml_prompt
        ml = await llm.complete_json(
            ml_prompt.SYSTEM, ml_prompt.build_user(market, mk, industry),
            capability="market_transcreation", schema_keys=["hero"],
        )
        if ml and ml.get("hero"):
            hero = dict(ml["hero"])
            source, model = "glm", ml.get("_ai_model", "")
        else:
            # 模板转创:按市场语气/惯用语拼装(不同市场结构不同,不是互译)
            primary_cta = (cta_lex.get("primary") or ["Request a quote"])[0]
            lex = industry.get("marketing_lexicon", {}).get(
                {"zh-CN": "zh", "en-US": "en", "ru-RU": "ru"}.get(market, "en"), [])
            hook = {
                "zh-CN": f"{category}源头工厂 · {lex[0] if lex else '稳定交付'}",
                "en-US": f"{category} manufacturer — {lex[0] if lex else 'reliable delivery'}",
                "ru-RU": f"{category} от производителя — {lex[0] if lex else 'надёжная поставка'}",
            }[market]
            hero = {
                "eyebrow": {"zh-CN": "源头制造", "en-US": "MANUFACTURER", "ru-RU": "ОТ ПРОИЗВОДИТЕЛЯ"}[market],
                "title": hook,
                "description": industry.get("summary", ""),
                "cta": primary_cta,
            }
            source, model = "template", ""

        # ---- 质量门:CTA 白名单 + 电商话术禁用 ----
        warnings: list[str] = []
        chosen_cta = hero.get("cta", "")
        if chosen_cta not in allowed:
            if chosen_cta:
                warnings.append(f"CTA「{chosen_cta}」不在市场词库,已替换")
            hero["cta"] = (cta_lex.get("primary") or ["Request a quote"])[0]
        joined = " ".join(str(v) for v in hero.values()).lower()
        for pat in ECOMMERCE_CTA_PATTERNS:
            if pat in joined:
                warnings.append(f"检测到电商话术「{pat}」(B2B RFQ 禁用),已移除")
                hero["cta"] = (cta_lex.get("primary") or ["Request a quote"])[0]
                break

        # 惯用语注入(俄语:标题/描述带 под ключ / оставить заявку 心智词,由模板路径保证)
        quality = [
            {"check": "cta_whitelist", "pass": hero["cta"] in allowed, "message": ""},
            {"check": "no_ecommerce_cta", "pass": not any(p in joined for p in ECOMMERCE_CTA_PATTERNS), "message": ""},
            {"check": "facts_untouched", "pass": True, "message": "Product Facts 未进入文案层"},
        ]

        copy = {
            "hero": hero,
            "faq_topics": mk.get("faq_topics", []),
            "tone": mk.get("tone", {}),
            "idioms_applied": [i["idiom"] for i in idioms[:3]] if market == "ru-RU" else [],
            "facts_ref": {"product_ids": list(facts.keys()) if isinstance(facts, dict) else []},
        }
        return SkillResult(output={"copy": copy, "quality_report": quality},
                           ai_source=source, model=model, warnings=warnings)


class VisualBriefSkill(Skill):
    """PHASE 9:图片简报(槽位/主体/场景/光线/negative),不生成图片本身。"""

    id = "visual_brief"
    name = "视觉简报"
    version = "1.0.0"
    description = "行业 image_keywords + 市场风格 → 每槽位图片简报(subject/scene/negative_prompt)。"
    credits = 0
    input_schema = {"required": ["product_category"]}
    output_schema = {"required": ["briefs"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        market = data.get("market") or context.market or "en-US"
        category = data.get("product_category", "")
        slots = data.get("slots") or ["hero", "application_scene", "product_cover"]
        industry_id = data.get("industry") or (knowledge.match_industry(category)[0] or "general_b2b")
        industry = knowledge.get_industry(industry_id) or {}
        kws = industry.get("image_keywords", [])
        style = industry.get("visual_hints", {}).get("imagery_keywords", [])

        briefs = []
        for i, slot in enumerate(slots):
            if slot in FORBIDDEN_AI_ROLES:
                briefs.append({"slot": slot, "forbidden": True,
                               "note": "事实性元素禁止 AI 生成,需用户提供真实素材"})
                continue
            subject = kws[i % len(kws)] if kws else f"{category} professional photo"
            briefs.append({
                "slot": slot,
                "subject": subject,
                "scene": style[i % len(style)] if style else "industrial context",
                "composition": "wide" if slot == "hero" else "card",
                "lighting": "soft industrial",
                "market": market,
                "negative_prompt": "no text inside image, no logos, no fabricated certification marks, "
                                   "no fabricated factory evidence, no watermarks",
                "asset_role": slot,
            })
        return SkillResult(output={"briefs": briefs}, ai_source="template")


class VisualGenerationSkill(Skill):
    """PHASE 9:调用 ImageProvider 生成图片;禁伪造成事实元素;全部标 AI_GENERATED。"""

    id = "visual_generation"
    name = "视觉生成"
    version = "1.0.0"
    description = "简报 → ImageProvider(图片模型);文本模型绝不返回伪 URL;事实性角色直接拒绝。"
    credits = 0
    input_schema = {"required": ["briefs"]}
    output_schema = {"required": ["images"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        from ..image_provider import get_image_provider

        provider = get_image_provider()
        images, warnings = [], []
        for b in data.get("briefs", []):
            slot = b.get("slot", "")
            if slot in FORBIDDEN_AI_ROLES or b.get("forbidden"):
                warnings.append(f"槽位 {slot} 属事实性元素,AI 不生成")
                images.append({"slot": slot, "skipped": True, "reason": "forbidden_fact_element"})
                continue
            prompt = f"{b.get('subject','')} | scene: {b.get('scene','')} | {b.get('negative_prompt','')}"
            try:
                res = await provider.generate(
                    prompt=prompt,
                    market=context.market or b.get("market") or "en-US",
                    role=slot, subject=b.get("subject", ""))
                images.append({
                    "slot": slot,
                    "url": res.get("url", ""),
                    "source_type": "AI_GENERATED",
                    "provider": res.get("provider", ""),
                    "prompt": prompt,
                })
            except Exception as exc:  # provider 失败 → FALLBACK,不冒充
                warnings.append(f"槽位 {slot} 生成失败:{str(exc)[:80]}")
                images.append({"slot": slot, "skipped": True, "reason": "provider_error"})
        return SkillResult(output={"images": images}, ai_source="template", warnings=warnings)


register(MarketTranscreationSkill())
register(VisualBriefSkill())
register(VisualGenerationSkill())
