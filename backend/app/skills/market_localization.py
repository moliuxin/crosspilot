"""ThemeStyleSkill + MarketLocalizationSkill + LayoutPlanningSkill + ComponentSelectionSkill
(PHASE 3/4/5 的后端部分)。全部消费知识库,输出 Schema,不输出 HTML。"""
from __future__ import annotations

from .. import knowledge, llm
from ..prompts import market_localization as ml_prompt
from ..prompts import site_planner
from .base import Skill, SkillContext, SkillResult
from .registry import register

from .component_registry import COMPONENTS, MARKET_SIGNATURE_SECTIONS, layout_for_market


class ThemeStyleSkill(Skill):
    """行业 palette_family + 市场色温微调 → DesignTokenProfile(WCAG 对比度校验)。"""

    id = "theme_style"
    name = "主题风格 Tokens"
    version = "1.0.0"
    description = "行业画像 + 市场 → DesignTokenProfile(配色/字体/圆角/密度),WCAG AA 校验。"
    credits = 0
    input_schema = {"required": ["industry"]}
    output_schema = {"required": ["design_tokens", "wcag_report"]}

    PALETTES = {
        "steel_safety": {"primary": "#1f2733", "primary_deep": "#141a24", "accent": "#c2570c", "accent_deep": "#9a4306", "on_dark": "#e6ebf2", "on_accent": "#ffffff"},
        "midnight_blue": {"primary": "#0b1b3a", "primary_deep": "#060f22", "accent": "#0284c7", "accent_deep": "#0369a1", "on_dark": "#e2e8f0", "on_accent": "#ffffff"},
        "graphite_violet": {"primary": "#1e1b2e", "primary_deep": "#12101d", "accent": "#7c3aed", "accent_deep": "#6d28d9", "on_dark": "#ece9f7", "on_accent": "#ffffff"},
        "solar_amber": {"primary": "#14212b", "primary_deep": "#0c151c", "accent": "#b45309", "accent_deep": "#9a4306", "on_dark": "#e8edf2", "on_accent": "#ffffff"},
        "warm_neutral": {"primary": "#2b2320", "primary_deep": "#1c1613", "accent": "#b45309", "accent_deep": "#92400e", "on_dark": "#efe9e4", "on_accent": "#ffffff"},
        "professional_blue": {"primary": "#0f2a5f", "primary_deep": "#0a1c40", "accent": "#2563eb", "accent_deep": "#1d4ed8", "on_dark": "#e5ecf8", "on_accent": "#ffffff"},
    }
    INDUSTRY_LEVEL = {"bg": "#f7f8fa", "surface": "#ffffff", "text": "#182230", "text_muted": "#5b6b7f", "border": "#e3e8ef"}

    # 市场色温/形态微调(确定性,不经过 LLM):
    # en 留白圆润/冷白底 · zh 中性工业 · ru 务实硬朗(直角+深 accent+冷灰底)
    # 字体栈为真实 CSS 栈:标题用 LUMINA 级衬线显示字体(en/ru=Playfair[含西里尔],
    # zh=Noto Serif SC 宋体文气),正文保持无衬线保证参数表/长文可读性
    MARKET_THEME: dict[str, dict] = {
        "zh-CN": {
            "bg": "#f7f8fa", "radius": "8px", "shadow_style": "soft",
            "heading_font": "'Noto Serif SC', 'Playfair Display', Georgia, serif",
            "body_font": "system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        "en-US": {
            "bg": "#f8fafc", "radius": "10px", "shadow_style": "soft",
            "heading_font": "'Playfair Display', 'Cinzel', Georgia, serif",
            "body_font": "system-ui, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        },
        "ru-RU": {
            "bg": "#f4f6f8", "radius": "4px", "shadow_style": "flat",
            "accent": "#b34e0a", "accent_deep": "#8f3f05",  # 加深保证白字对比度只升不降
            "heading_font": "'Playfair Display', 'PT Sans', Georgia, serif",
            "body_font": "system-ui, 'PT Sans', 'Segoe UI', Arial, sans-serif",
        },
    }

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        industry = knowledge.get_industry(data.get("industry") or "") or {}
        market = data.get("market", "en-US")
        family = industry.get("visual_hints", {}).get("palette_family", "professional_blue")
        palette = self.PALETTES.get(family, self.PALETTES["professional_blue"])
        market_style = (knowledge.market_knowledge(market) or {}).get("style", {})
        tokens = {
            **palette,
            **self.INDUSTRY_LEVEL,
            **self.MARKET_THEME.get(market, self.MARKET_THEME["en-US"]),
            # density 由市场 style.json 决定(en medium 留白 / zh、ru high 信息密度)
            "density": market_style.get("density", industry.get("layout_hints", {}).get("layout_variant", "editorial")),
            "market_notes": market_style.get("notes", ""),
        }
        report = wcag_check(tokens)
        return SkillResult(output={"design_tokens": tokens, "wcag_report": report},
                           ai_source="template",
                           warnings=[r["message"] for r in report if not r["pass"]])


def _rel_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip('#')
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast_ratio(a: str, b: str) -> float:
    la, lb = _rel_luminance(a), _rel_luminance(b)
    lo, hi = min(la, lb), max(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def wcag_check(tokens: dict) -> list[dict]:
    """WCAG 2.1 AA:深底正文 ≥4.5,按钮文字(≥14pt 半粗)≥3.0。"""
    checks = [
        ("on_dark", "primary", 4.5, "深底正文"),
        ("on_accent", "accent", 3.0, "按钮文字"),
        ("text", "bg", 4.5, "浅底正文"),
    ]
    out = []
    for fg, bg, need, scope in checks:
        try:
            ratio = contrast_ratio(tokens[fg], tokens[bg])
            out.append({"scope": scope, "pair": [fg, bg], "ratio": round(ratio, 2),
                        "required": need, "pass": ratio >= need,
                        "message": "" if ratio >= need else f"{scope} 对比度 {ratio:.2f} < {need}"})
        except Exception:
            out.append({"scope": scope, "ratio": None, "pass": False, "message": f"{scope} 颜色无法解析"})
    return out


class MarketLocalizationSkill(Skill):
    """市场知识(Profile + CTA/语气/惯用语/合规)→ 市场化 hero/CTA;不是翻译。"""

    id = "market_localization"
    name = "市场本地化"
    version = "1.0.0"
    description = "Market Profile + CTA 词库 + 语气/惯用语 → 市场化表达(hero/CTA/FAQ 主题)。GLM 优先,降级模板。"
    credits = 0
    input_schema = {"required": ["market", "product_category"]}
    output_schema = {"required": ["hero", "cta_lexicon", "tone", "compliance_note"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        market = data.get("market", "en-US")
        category = data.get("product_category", "")
        knowledge_ = knowledge.market_knowledge(market)
        if not knowledge_:
            return SkillResult(output={}, ai_source="template", warnings=[f"未知市场:{market}"])

        industry_id = data.get("industry") or (knowledge.match_industry(category)[0] or "general_b2b")
        industry = knowledge.get_industry(industry_id) or {}

        # GLM 生成市场 hero(schema: hero);CTA 一律从词库取,模型不得自造
        result = await llm.complete_json(
            ml_prompt.SYSTEM, ml_prompt.build_user(market, knowledge_, industry),
            capability="market_localization", schema_keys=["hero"],
        )
        cta = knowledge_.get("cta", {})
        compliance = knowledge_.get("compliance", {})
        note = compliance.get("note") if isinstance(compliance, dict) else str(compliance)
        if result and result.get("hero"):
            hero = result["hero"]
            hero["cta"] = self._pick_cta(cta, hero.get("cta"))
            out = {
                "hero": hero,
                "cta_lexicon": cta,
                "tone": knowledge_.get("tone", {}),
                "idioms": knowledge_.get("idioms", {}).get("idioms", []),
                "compliance_note": note or "",
                "style": knowledge_.get("style", {}),
            }
            return SkillResult(output=out, ai_source="glm", model=result.get("_ai_model", ""))

        # 降级:词库直接拼 hero(不经过模型,如实标注)
        primary = (cta.get("primary") or ["Request a quote"])[0]
        out = {
            "hero": {
                "title": f"{category} — {market}",
                "description": industry.get("summary", ""),
                "cta": primary,
            },
            "cta_lexicon": cta,
            "tone": knowledge_.get("tone", {}),
            "idioms": knowledge_.get("idioms", {}).get("idioms", []),
            "compliance_note": note or "",
            "style": knowledge_.get("style", {}),
        }
        return SkillResult(output=out, ai_source="template")

    @staticmethod
    def _pick_cta(lexicon: dict, candidate: str) -> str:
        allowed = set(lexicon.get("primary", []) + lexicon.get("secondary", []))
        if candidate in allowed:
            return candidate
        return (lexicon.get("primary") or ["Request a quote"])[0]


# (签名区块定义移至 component_registry.MARKET_SIGNATURE_SECTIONS —— layout_for_market 同样消费)


class LayoutPlanningSkill(Skill):
    """市场 + 行业 → layout_schema(sections 顺序与组件选择)。默认来自 Market Profile,不硬编码在 React。

    LLM 输出仅提供选型/variant/props;区块集合与顺序必须经市场策略校正:
    1) 过滤本市场不支持的组件(如 key_specs 不得进 en-US);
    2) 签名区块缺失时补齐;
    3) 按市场默认序重排 —— 保证 zh 工厂前置 / en 利益前置 / ru 参数前置肉眼可辨。
    """

    id = "layout_planning"
    name = "布局规划"
    version = "1.1.0"
    description = "行业画像 layout_hints + 市场 sections 默认 → layout_schema(组件 id/type/variant/props)。"
    credits = 0
    input_schema = {"required": ["market"]}
    output_schema = {"required": ["sections"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        market = data.get("market", "en-US")
        category = data.get("product_category", "")
        industry_id = data.get("industry") or (knowledge.match_industry(category)[0] or "general_b2b")
        industry = knowledge.get_industry(industry_id) or {}

        def _allows(t: str) -> bool:
            allowed = COMPONENTS.get(t, {}).get("supported_markets", ["*"])
            return "*" in allowed or market in allowed

        sections: list[dict] = []
        source, model = "template", ""
        result = await llm.complete_json(
            site_planner.SYSTEM, site_planner.build_user(industry, {"personas": []}, [market]),
            capability="layout_planning", schema_keys=["site_structure"],
        )
        if result and isinstance(result.get("site_structure"), list) and result["site_structure"]:
            seen: set[str] = set()
            for s in result["site_structure"]:
                t = s.get("type")
                if t in COMPONENTS and t not in seen and _allows(t):
                    seen.add(t)
                    sections.append(s)
            source, model = "glm", result.get("_ai_model", "")

        # 市场策略校正(LLM 已返回也执行;LLM 不可用时回落市场默认布局,本就符合市场序)
        if sections:
            default_order = [d["type"] for d in layout_for_market(market, industry)]
            source = "glm+market_profile"
            # 1) 签名区块缺失 → 插到 hero 之后(LLM 常见漏选)
            hero_pos = next((i for i, s in enumerate(sections) if s.get("type") == "hero"), -1)
            insert_at = hero_pos + 1
            present = {s.get("type") for s in sections}
            for t in sorted(MARKET_SIGNATURE_SECTIONS.get(market, set()),
                            key=lambda x: default_order.index(x) if x in default_order else 99):
                if t not in present and _allows(t):
                    sections.insert(min(insert_at, len(sections)), {"type": t})
                    insert_at += 1
                    present.add(t)
            # 2) 按市场默认序重排(市场外新区块排尾部,保持相对顺序)
            order = {t: i for i, t in enumerate(default_order)}
            sections.sort(key=lambda s: order.get(s.get("type"), len(order)))
        else:
            sections = layout_for_market(market, industry)

        # 每节绑定注册表元数据(组件能力/市场适配)
        enriched = []
        for s in sections:
            meta = COMPONENTS.get(s.get("type"), {})
            enriched.append({
                "id": s.get("id") or f"sec_{s.get('type', 'block')}",
                "type": s.get("type"),
                "variant": s.get("variant") or meta.get("default_variant", ""),
                "props": s.get("props", {}),
                "component_meta": {
                    "name": meta.get("name", s.get("type")),
                    "asset_slots": meta.get("asset_slots", []),
                    "supported_markets": meta.get("supported_markets", ["*"]),
                },
            })
        return SkillResult(output={"sections": enriched, "layout_source": source},
                           ai_source=source, model=model)


register(ThemeStyleSkill())
register(MarketLocalizationSkill())
register(LayoutPlanningSkill())
