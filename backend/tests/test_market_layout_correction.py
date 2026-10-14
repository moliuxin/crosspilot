# -*- coding: utf-8 -*-
"""三市场布局策略校正 E2E(导师规范 4.3/4.5)。

LLM 对三个市场常给出雷同的 site_structure;LayoutPlanningSkill 必须用
Market Profile 校正:组件市场过滤 + 签名区块补齐 + 市场默认序重排。
验收:同一"懒 LLM"输入,zh 工厂前置 / en 利益前置 / ru 参数前置,
三套 section 顺序两两不同;不支持组件(如 key_specs→en)被剔除。
"""
import asyncio

import pytest

from app.skills.base import SkillContext
from app.skills.market_localization import LayoutPlanningSkill

# 懒 LLM:三市场返回完全相同的结构(现实中最常见的失败模式)
_LAZY_STRUCTURE = {
    "site_structure": [
        {"type": "hero", "variant": "minimal"},
        {"type": "key_specs"},        # en-US 不支持的组件
        {"type": "applications"},
        {"type": "products"},
        {"type": "cases"},
        {"type": "rfq"},
    ]
}


@pytest.fixture
def lazy_llm(monkeypatch):
    """所有市场都返回同一结构的 mock LLM。"""
    async def fake_complete_json(*args, **kwargs):
        print("\nFAKE-COMPLETE-JSON-CALLED market-arg:", kwargs)
        return {**_LAZY_STRUCTURE, "_ai_model": "mock"}
    import app.skills.market_localization as ml
    monkeypatch.setattr(ml.llm, "complete_json", fake_complete_json)


def _run(market: str) -> list[str]:
    import app.skills.market_localization as ml_dbg
    print("MODULE-FILE:", ml_dbg.__file__)
    res = asyncio.run(LayoutPlanningSkill().execute(
        SkillContext(tenant_id=1, market=market),
        {"market": market, "product_category": "10kg Collaborative Robot", "industry": "industrial_robotics"},
    ))
    assert res.output["sections"], res
    return [s["type"] for s in res.output["sections"]]


def test_lazy_llm_zh_factory_first(lazy_llm):
    order = _run("zh-CN")
    assert order[0] == "hero"
    assert "factory" in order[:3]          # 制造能力前置
    assert order.index("factory") < order.index("products")


def test_lazy_llm_en_benefits_first(lazy_llm):
    order = _run("en-US")
    assert order[0] == "hero"
    assert "key_specs" not in order        # en 不支持的组件被市场过滤剔除
    assert "benefits" in order[:3]         # 价值/利益前置
    assert order.index("benefits") < order.index("products")


def test_lazy_llm_ru_specs_first(lazy_llm):
    order = _run("ru-RU")
    assert order[0] == "hero"
    assert order[1] == "key_specs"         # 参数前置
    assert "supply_capability" in order[:4]
    assert "benefits" not in order         # en 组件不得泄入 ru


def test_three_market_orders_all_differ(lazy_llm):
    zh, en, ru = _run("zh-CN"), _run("en-US"), _run("ru-RU")
    assert zh != en and zh != ru and en != ru
    # 结构级差异量化:两两至少 3 处位置不同(非翻译级差异)
    def _diff(a, b):
        return sum(1 for i, t in enumerate(a) if i >= len(b) or b[i] != t) + abs(len(a) - len(b))
    assert _diff(zh, en) >= 3
    assert _diff(zh, ru) >= 3
    assert _diff(en, ru) >= 3


def test_layout_source_marks_correction(lazy_llm):
    res = asyncio.run(LayoutPlanningSkill().execute(
        SkillContext(tenant_id=1, market="zh-CN"),
        {"market": "zh-CN", "product_category": "10kg Collaborative Robot"},
    ))
    assert res.output["layout_source"] == "glm+market_profile"
    assert res.ai_source == "glm+market_profile"


def test_llm_failure_falls_back_to_market_default(monkeypatch):
    async def broken(*args, **kwargs):
        return None
    import app.skills.market_localization as ml
    monkeypatch.setattr(ml.llm, "complete_json", broken)
    order = _run("ru-RU")
    assert order[0] == "hero" and order[1] == "key_specs"
    assert "supply_capability" in order
