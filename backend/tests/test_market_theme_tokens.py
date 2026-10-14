# -*- coding: utf-8 -*-
"""三市场 Design Tokens 差异化(导师规范 4.2:design_tokens 每市场独立生成)。

ThemeStyleSkill 此前完全忽略 market 参数,三市场 tokens 全同(连字体都是
微软雅黑)。修复后:市场色温/圆角/字体栈/密度确定性差异化,WCAG 校验保持通过。
"""
import asyncio

from app.skills.base import SkillContext
from app.skills.market_localization import ThemeStyleSkill


def _tokens(market: str) -> dict:
    res = asyncio.run(ThemeStyleSkill().execute(
        SkillContext(tenant_id=1, market=market),
        {"industry": "industrial_robotics", "market": market},
    ))
    assert res.output["design_tokens"], res
    assert all(r["pass"] for r in res.output["wcag_report"]), res.output["wcag_report"]
    return res.output["design_tokens"]


def test_three_market_tokens_differ():
    zh, en, ru = _tokens("zh-CN"), _tokens("en-US"), _tokens("ru-RU")
    # 关键视觉字段至少两项互异
    keys = ("bg", "radius", "heading_font", "accent", "shadow_style")
    for a, b in (("zh", "en"), ("zh", "ru"), ("en", "ru")):
        ta, tb = {"zh": zh, "en": en, "ru": ru}[a], {"zh": zh, "en": en, "ru": ru}[b]
        diff = sum(1 for k in keys if ta.get(k) != tb.get(k))
        assert diff >= 2, (a, b, {k: (ta.get(k), tb.get(k)) for k in keys})


def test_market_font_stacks():
    en = _tokens("en-US")
    ru = _tokens("ru-RU")
    zh = _tokens("zh-CN")
    assert "PingFang SC" in zh["body_font"] or "Microsoft YaHei" in zh["body_font"]
    assert "Segoe UI" in en["body_font"]
    assert "PT Sans" in ru["body_font"]


def test_market_density_from_style_json():
    # en 留白 medium,zh/ru 信息密度 high(knowledge/markets/*/style.json)
    assert _tokens("en-US")["density"] == "medium"
    assert _tokens("zh-CN")["density"] == "high"
    assert _tokens("ru-RU")["density"] == "high"


def test_ru_accent_stays_wcag_safe():
    ru = _tokens("ru-RU")
    assert ru["accent"] != "#c2570c"  # 市场微调确实生效
    # 白字按钮对比度由 wcag_check 保证(上方 _tokens 已断言全 pass)
