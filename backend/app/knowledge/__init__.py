"""知识库访问层:行业画像 + 市场知识(cta/tone/idioms/compliance/style)。"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

_DIR = os.path.dirname(__file__)
INDUSTRIES_DIR = os.path.join(_DIR, "industries")
MARKETS_DIR = os.path.join(_DIR, "markets")

SUPPORTED_MARKETS = ("zh-CN", "en-US", "ru-RU")


@lru_cache(maxsize=1)
def list_industries() -> list[str]:
    return sorted(f[:-5] for f in os.listdir(INDUSTRIES_DIR) if f.endswith(".json"))


@lru_cache(maxsize=32)
def get_industry(industry_id: str) -> dict[str, Any] | None:
    path = os.path.join(INDUSTRIES_DIR, f"{industry_id}.json")
    if not os.path.exists(path):
        return None
    return json.load(open(path, encoding="utf-8"))


def match_industry(text: str) -> tuple[str | None, float]:
    """按别名匹配行业。返回 (industry_id, 置信度 0~1)。命中别名数越多置信度越高。"""
    if not text:
        return None, 0.0
    t = text.lower()
    best, best_hits = None, 0
    for iid in list_industries():
        prof = get_industry(iid)
        hits = sum(1 for a in prof.get("aliases", []) if a.lower() in t or t in a.lower())
        if hits > best_hits:
            best, best_hits = iid, hits
    if best is None:
        return None, 0.0
    return best, min(1.0, 0.5 + 0.25 * best_hits)


@lru_cache(maxsize=16)
def market_knowledge(market: str) -> dict[str, Any]:
    """一个市场的全部知识:cta/tone/idioms/compliance/style。无效市场返回空 dict。"""
    if market not in SUPPORTED_MARKETS:
        return {}
    out: dict[str, Any] = {}
    d = os.path.join(MARKETS_DIR, market)
    for name in ("cta", "tone", "idioms", "compliance", "style"):
        p = os.path.join(d, f"{name}.json")
        if os.path.exists(p):
            out[name] = json.load(open(p, encoding="utf-8"))
    return out
