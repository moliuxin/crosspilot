"""市场表达配置（Market Profile）加载器。

产品规则（P0-MARKET-PROFILE）：
- zh-CN / en-US / ru-RU 不是翻译，而是同一商品事实在不同市场的独立表达版本；
- Fact Layer（产品事实）共享且不得被市场 AI 改写；
- Market Layer（层级 / 文案 / 视觉 / CTA / FAQ）允许不同；
- Profile 基于「目标市场采购阅读策略」，可配置、可用真实用户数据更新，
  不是不可变化的刻板印象。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PROFILE_DIR = Path(__file__).parent / "market_profiles"

SUPPORTED_MARKETS = ("zh-CN", "en-US", "ru-RU")

# 共享事实层：这些字段是商品事实，任何市场的 AI 生成都不允许改写
SHARED_FACT_FIELDS = (
    "product_id",
    "sku",
    "model",
    "specs",
    "material",
    "technical_parameters",
    "certifications",
    "moq",
    "lead_time",
)


@lru_cache(maxsize=1)
def _load_all() -> dict[str, dict]:
    profiles: dict[str, dict] = {}
    for market in SUPPORTED_MARKETS:
        path = PROFILE_DIR / f"{market}.json"
        if not path.exists():
            continue
        with open(path, encoding="utf-8") as f:
            profiles[market] = json.load(f)
    return profiles


def get_profile(market: str) -> dict | None:
    """单个市场 Profile；不存在返回 None。"""
    return _load_all().get(market)


def list_profiles() -> list[dict]:
    """全部市场 Profile（顺序固定：zh → en → ru）。"""
    all_p = _load_all()
    return [all_p[m] for m in SUPPORTED_MARKETS if m in all_p]


def market_summary() -> dict:
    """供 /api/market-profiles 输出：Profiles + 共享事实层说明。"""
    return {
        "markets": list_profiles(),
        "sharedFactFields": list(SHARED_FACT_FIELDS),
        "note": "Market Layer 允许不同；Fact Layer 共享且不得被市场 AI 改写。",
    }
