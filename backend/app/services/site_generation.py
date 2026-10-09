"""AI 整站生成（P0-AI-SITE-GENERATION）。

结构化生成链（不直接输出 HTML）：

    User Input
    → Industry Analyzer        （prompts/industry_analyzer.py，LLM 优先）
    → Buyer Persona            （prompts/buyer_persona.py）
    → Market Profile           （app.market_profiles 配置真源，非 LLM）
    → Site Plan                （prompts/site_planner.py）
    → Copy / CTA / Trust / SEO（并入 plan）
    → Image Briefs             （prompts/image_brief.py）
    → ImageProvider            （GLM-Image / mock，产 Asset）
    → Draft Site + Pages

LLM 未配置或调用失败时降级为「类别感知的内置模板」，保证演示不中断；
生成结果标注 _source = llm | template。
"""
from __future__ import annotations

import logging
from typing import Any

from .. import llm, market_profiles
from ..prompts import image_brief as ib_prompt
from ..prompts import industry_analyzer, site_planner

logger = logging.getLogger(__name__)

SECTION_TYPES = ("hero", "trust", "products", "applications", "capability", "cases", "cta")

STYLE_PRESETS = {
    "professional": "premium B2B industrial photography, generous negative space, deep blue palette",
    "minimal": "clean minimal international commerce, light backgrounds, restrained accents",
    "tech": "dark tech product close-ups, precise spec presentation",
    "premium": "high-end editorial industrial, cinematic lighting",
    "ai": "AI recommended style for the product category",
}


# ---------------- 降级模板（类别感知） ----------------

def _degrade_industry(category: str) -> dict:
    return {
        "industry": "general_manufacturing",
        "industry_label": f"{category}",
        "buyer_type": "采购经理 / 工程 OEM 采购",
        "decision_factors": ["参数与工况匹配", "供货稳定性与交期", "认证与质保", "供应商配合度"],
        "trust_evidence": ["认证证书", "应用案例", "检测报告", "本地化支持"],
        "compliance": ["CE", "ISO 9001"],
        "value_words": {
            "zh": ["可靠", "定制", "量产", "快速交付"],
            "en": ["reliable", "customizable", "scale", "fast delivery"],
            "ru": ["надёжный", "кастомизация", "серийно", "быстрая поставка"],
        },
    }


def _market_hero(category: str, market: str) -> dict:
    """降级模板的市场 hero —— 三市场表达真实不同（非翻译）。"""
    if market == "zh-CN":
        return {
            "eyebrow": f"{category}制造厂家",
            "title": f"{category}批量制造与定制",
            "description": "自有产线、完整检测与出厂流程，支持 OEM/ODM，交期可控。",
            "cta": "获取报价方案",
        }
    if market == "ru-RU":
        return {
            "eyebrow": f"ПРОИЗВОДСТВО: {category}",
            "title": f"{category} для промышленных объектов",
            "description": "Технические характеристики, стабильные сроки поставки, поддержка на месте.",
            "cta": "Запросить расчёт",
        }
    return {
        "eyebrow": f"{category.upper()} MANUFACTURER",
        "title": f"{category.title()} Engineered for Your Projects",
        "description": f"Spec-driven {category} with certified quality, global delivery and engineering support.",
        "cta": "Get a Quote",
    }


def _degrade_markets(category: str, markets: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for m in markets:
        profile = market_profiles.get_profile(m) or {}
        hero = _market_hero(category, m)
        out[m] = {
            "market": m,
            "hero": hero,
            "section_order": profile.get("content_hierarchy") and
                ["hero", "trust", "products", "applications", "capability", "cases", "cta"] or
                ["hero", "products", "trust", "cta"],
            "cta_style": profile.get("cta_style", hero["cta"]),
            "faq_topics": profile.get("faq_topics", ["Lead time?", "OEM/ODM?", "Warranty?", "Certification?"]),
            "selling_points": (profile.get("buyer_focus") or "")[:80],
            "tone_note": profile.get("tone", ""),
            "visual_style": profile.get("visual_style", ""),
        }
    return out


def _degrade_structure() -> list[dict]:
    return [
        {"type": "hero", "label": "Hero 首屏", "reason": "3 秒内让买家知道你是谁、能解决什么"},
        {"type": "trust", "label": "信任背书", "reason": "认证与资质前置，降低首次询价顾虑"},
        {"type": "products", "label": "核心产品", "reason": "按采购视角组织产品线入口"},
        {"type": "applications", "label": "应用场景", "reason": "让买家对号入座自己的工况"},
        {"type": "capability", "label": "企业能力", "reason": "产能 / 工程 / 交付能力证明"},
        {"type": "cases", "label": "项目案例", "reason": "同类项目背书"},
        {"type": "cta", "label": "询盘 CTA", "reason": "低承诺压力的询价入口"},
    ]


def _degrade_briefs(category: str, markets: list[str], sections: list[str]) -> list[dict]:
    briefs = []
    scene_by_market = {
        "zh-CN": "modern manufacturing plant, production line, quality inspection",
        "en-US": "clean application scenario, product close-up, international procurement context",
        "ru-RU": "industrial site, machinery details, large engineering project",
    }
    for m in markets:
        for sec in sections:
            if sec in ("hero", "applications", "capability", "cases"):
                role = "hero" if sec == "hero" else "application_scene" if sec == "applications" else "background"
                briefs.append({
                    "section_type": sec,
                    "image_role": role,
                    "subject": category,
                    "scene": scene_by_market.get(m, scene_by_market["en-US"]),
                    "style": "premium B2B industrial photography",
                    "composition": "subject left, clean negative space right" if sec == "hero" else "full-bleed scene",
                    "negative": "no text, no logos, no fabricated certification marks",
                    "market": m,
                })
    return briefs


# ---------------- 生成主流程 ----------------

async def generate_site_plan(
    company_name: str,
    product_category: str,
    product_description: str,
    target_buyer: str,
    target_markets: list[str],
    preferred_style: str,
    template_id: str = "",
) -> dict[str, Any]:
    """产出完整 SiteGenerationPlan（LLM 优先，失败降级模板）。

    返回结构（与指令一致）：
    industry_profile / buyer_personas / markets / site_structure / sections /
    cta_plan / trust_plan / seo_plan / image_briefs / visual_style_profile / _source
    """
    markets = [m for m in target_markets if m in market_profiles.SUPPORTED_MARKETS] or ["en-US"]

    # 1) 行业理解
    industry = await llm.complete_json(
        industry_analyzer.SYSTEM, industry_analyzer.build_user(product_category, product_description)
    )
    source = "llm"
    if not industry or not industry.get("industry"):
        industry = _degrade_industry(product_category)
        source = "template"

    # 2) 买家画像
    from ..prompts import buyer_persona as bp_prompt

    personas = await llm.complete_json(
        bp_prompt.SYSTEM, bp_prompt.build_user(industry, target_buyer)
    )
    if not personas or not personas.get("personas"):
        personas = {
            "personas": [
                {
                    "role": target_buyer or "采购经理",
                    "cares_about": ["参数匹配", "交期", "认证"],
                    "objections": ["供应商可靠性未知", "售后网络不明"],
                    "search_terms": {
                        "zh": [f"{product_category} 厂家"],
                        "en": [f"{product_category} manufacturer"],
                        "ru": [f"{product_category} производитель"],
                    },
                }
            ]
        }
        source = "template"

    # 3) 市场表达层（Profile 是配置真源；hero 走 LLM，失败降级）
    market_layer: dict[str, dict] = {}
    from ..prompts import market_localization as ml_prompt

    for m in markets:
        profile = market_profiles.get_profile(m) or {}
        ml = await llm.complete_json(ml_prompt.SYSTEM, ml_prompt.build_user(m, profile, industry))
        if ml and ml.get("hero"):
            market_layer[m] = ml
        else:
            market_layer[m] = _degrade_markets(product_category, [m])[m]
            source = "template"

    # 4) 站点结构
    plan = await llm.complete_json(
        site_planner.SYSTEM, site_planner.build_user(industry, personas, markets)
    )
    if plan and isinstance(plan.get("site_structure"), list) and plan["site_structure"]:
        structure = [s for s in plan["site_structure"] if s.get("type") in SECTION_TYPES]
        cta_plan = plan.get("cta_plan") or {}
        trust_plan = plan.get("trust_plan") or {}
        seo_plan = plan.get("seo_plan") or {}
    else:
        structure = _degrade_structure()
        cta_plan = {"primary": market_layer[markets[0]]["hero"]["cta"], "secondary": "View Products"}
        trust_plan = {"items": ["ISO 9001", "CE", "OEM / ODM", "48h Response"], "presentation": "trust strip"}
        seo_plan = {
            "title_pattern": f"{{company}} | {product_category} Manufacturer",
            "keyword_direction": {"zh": [f"{product_category} 厂家"], "en": [f"{product_category} manufacturer"], "ru": [f"{product_category} производитель"]},
            "schema": ["Organization", "Product", "FAQPage"],
        }
        source = "template"

    # 5) 视觉风格档案（整站统一，禁止风格漂移）
    style_key = preferred_style if preferred_style in STYLE_PRESETS else "professional"
    visual_style_profile = {
        "key": style_key,
        "prompt_style": STYLE_PRESETS[style_key],
        "palette": ["#0f2a5f", "#2563eb", "#e2e8f0", "#0b1220"],
        "note": "所有图片继承同一 Visual Style Profile",
    }

    # 6) 图片简报（LLM 优先；降级按类别+市场构造）
    sections = [s["type"] for s in structure if s["type"] in ("hero", "applications", "capability", "cases")]
    briefs = await llm.complete_json(
        ib_prompt.SYSTEM,
        ib_prompt.build_user(
            product_category, ", ".join(markets), target_buyer,
            template_id or style_key, visual_style_profile["prompt_style"], sections,
        ),
    )
    if briefs and isinstance(briefs.get("briefs"), list) and briefs["briefs"]:
        image_briefs = briefs["briefs"]
        # 补市场归属（LLM 可能不按市场拆分；按顺序轮转标注）
        for i, b in enumerate(image_briefs):
            b.setdefault("market", markets[i % len(markets)])
    else:
        image_briefs = _degrade_briefs(product_category, markets, sections)
        source = "template"

    return {
        "industry_profile": industry,
        "buyer_personas": personas,
        "markets": market_layer,
        "site_structure": structure,
        "sections": structure,
        "cta_plan": cta_plan,
        "trust_plan": trust_plan,
        "seo_plan": seo_plan,
        "image_briefs": image_briefs,
        "visual_style_profile": visual_style_profile,
        "shared_fact_fields": list(market_profiles.SHARED_FACT_FIELDS),
        "_source": source,
    }


def plan_to_home_sections(plan: dict, site_name: str) -> list[dict]:
    """把 SiteGenerationPlan 转成 PageEditor 可编辑的 sections 组件树。"""
    markets = list(plan.get("markets", {}).keys()) or ["en-US"]
    hero = plan["markets"][markets[0]]["hero"]
    trust = plan.get("trust_plan") or {}
    sections: list[dict] = []
    for i, s in enumerate(plan.get("site_structure") or []):
        stype = s["type"]
        sec_id = f"sec_{stype}"
        if stype == "hero":
            sections.append({
                "id": sec_id, "type": "hero", "label": "Hero 首屏",
                "props": {
                    "eyebrow": hero.get("eyebrow", site_name),
                    "title": hero.get("title", site_name),
                    "description": hero.get("description", ""),
                    "cta": hero.get("cta", "Get a Quote"),
                    "align": "left", "background": "dark", "padding": "comfortable",
                },
            })
        elif stype == "trust":
            sections.append({
                "id": sec_id, "type": "trust", "label": "信任背书",
                "props": {"items": trust.get("items") or ["ISO 9001", "CE", "OEM / ODM", "48h Response"]},
            })
        elif stype == "cta":
            cta = plan.get("cta_plan") or {}
            sections.append({
                "id": sec_id, "type": "cta", "label": "询盘 CTA",
                "props": {"title": cta.get("primary") or hero.get("cta", "Get a Quote"), "cta": hero.get("cta", "Send Inquiry")},
            })
        else:
            label = s.get("label") or stype.title()
            sections.append({
                "id": sec_id, "type": stype, "label": label,
                "props": {"eyebrow": stype.upper(), "title": label},
            })
        # sections 顺序保留 plan 的结构决策
        sections[-1]["order"] = i
    return sections
