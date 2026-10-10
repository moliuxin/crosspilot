"""Evaluation Metrics — 算法对比的客观指标(纯计算,无 LLM 依赖,确定性)。"""
from __future__ import annotations

import json
import math
from typing import Any


# ------------------- Market Differentiation -------------------

def jaccard_distance(a: list, b: list) -> float:
    """Jaccard distance: 0=identical, 1=completely different."""
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 0.0
    intersection = len(sa & sb)
    union = len(sa | sb)
    return 1.0 - (intersection / union) if union else 0.0


def market_differentiation(variants: list[dict]) -> float:
    """多市场 layout 的平均 Jaccard 距离(越高越好 → 越不同)。"""
    if len(variants) < 2:
        return 0.0
    orders = []
    for v in variants:
        sections = v.get("layout_schema", {}).get("sections", [])
        orders.append([s.get("type", "other") for s in sections])
    distances = []
    for i in range(len(orders)):
        for j in range(i + 1, len(orders)):
            distances.append(jaccard_distance(orders[i], orders[j]))
    return sum(distances) / len(distances) if distances else 0.0


def section_order_differentiation(variants: list[dict]) -> float:
    """考虑顺序的差异度(相同集合但不同顺序也计分)。"""
    if len(variants) < 2:
        return 0.0
    sequences = []
    for v in variants:
        sections = v.get("layout_schema", {}).get("sections", [])
        seq = [s.get("type", "other") for s in sections if s.get("type") != "other"]
        sequences.append(seq)
    # Pairwise: count positional mismatches normalized by max length
    scores = []
    for i in range(len(sequences)):
        for j in range(i + 1, len(sequences)):
            a, b = sequences[i], sequences[j]
            max_len = max(len(a), len(b))
            if max_len == 0:
                continue
            mismatches = sum(1 for x, y in zip(a + [""] * max_len, b + [""] * max_len) if x != y)
            scores.append(mismatches / max_len)
    return sum(scores) / len(scores) if scores else 0.0


# ------------------- Field Completeness -------------------

def required_field_completeness(variant: dict, required_sections: list[str]) -> float:
    """必需 section 的覆盖率。"""
    sections = variant.get("layout_schema", {}).get("sections", [])
    present = {s.get("type", "") for s in sections}
    if not required_sections:
        return 1.0
    return sum(1 for r in required_sections if r in present) / len(required_sections)


# ------------------- Procurement Coverage -------------------

PROCUREMENT_FIELDS = ["moq", "lead_time", "warranty", "certification", "oem", "payment_terms"]

def procurement_coverage(variant: dict) -> float:
    """采购信息覆盖率(在 content/props 中检查)。"""
    content = variant.get("content_json", {})
    copy = content.get("copy", {})
    all_text = json.dumps(copy, ensure_ascii=False).lower()
    # 也检查 sections props
    sections = variant.get("layout_schema", {}).get("sections", [])
    for s in sections:
        all_text += json.dumps(s.get("props", {}), ensure_ascii=False).lower()
    present = sum(1 for f in PROCUREMENT_FIELDS if f.replace("_", " ") in all_text or f in all_text)
    return present / len(PROCUREMENT_FIELDS)


# ------------------- CTA Compliance -------------------

ECOMMERCE_PATTERNS = ["buy now", "add to cart", "checkout", "立即购买", "加入购物车", "в корзину", "купить сейчас"]

def cta_compliance(variant: dict, market_lexicon: dict) -> dict:
    """CTA 合规:1)在词库内 2)无电商话术。"""
    sections = variant.get("layout_schema", {}).get("sections", [])
    hero = next((s for s in sections if s.get("type") == "hero"), {})
    cta_text = hero.get("props", {}).get("cta", "")
    all_props_text = " ".join(
        json.dumps(s.get("props", {}), ensure_ascii=False).lower()
        for s in sections
    )

    allowed = set(market_lexicon.get("primary", []) + market_lexicon.get("secondary", []))
    in_lexicon = cta_text in allowed if cta_text else False
    has_ecom = any(p in all_props_text for p in ECOMMERCE_PATTERNS)

    return {
        "cta_in_lexicon": in_lexicon,
        "no_ecommerce_cta": not has_ecom,
        "compliant": in_lexicon and not has_ecom,
        "cta_text": cta_text,
    }


# ------------------- Layout Appropriateness -------------------

MARKET_EXPECTATIONS = {
    "zh-CN": {"expected": ["factory", "solutions", "specs"], "unexpected": []},
    "en-US": {"expected": ["benefits", "applications"], "unexpected": []},
    "ru-RU": {"expected": ["key_specs", "supply_capability"], "unexpected": []},
}

def layout_appropriateness(variant: dict, market: str) -> float:
    """市场期望布局命中率。"""
    sections = variant.get("layout_schema", {}).get("sections", [])
    present = {s.get("type", "") for s in sections}
    expectations = MARKET_EXPECTATIONS.get(market, {"expected": [], "unexpected": []})
    expected = expectations.get("expected", [])
    unexpected = expectations.get("unexpected", [])
    if not expected:
        return 1.0
    hits = sum(1 for e in expected if e in present)
    penalties = sum(1 for u in unexpected if u in present)
    return max(0.0, (hits - penalties) / len(expected))


# ------------------- Structural Diversity -------------------

def structural_diversity(variants: list[dict]) -> int:
    """跨市场使用的不同 section type 数量。"""
    all_types = set()
    for v in variants:
        sections = v.get("layout_schema", {}).get("sections", [])
        all_types.update(s.get("type", "") for s in sections if s.get("type"))
    return len(all_types)


# ------------------- Design Token Differentiation -------------------

def design_token_differentiation(variants: list[dict]) -> float:
    """Design Token 差异度(配色/密度等)。"""
    if len(variants) < 2:
        return 0.0
    tokens = [v.get("design_tokens", {}) for v in variants]
    diffs = []
    for i in range(len(tokens)):
        for j in range(i + 1, len(tokens)):
            keys = set(tokens[i].keys()) | set(tokens[j].keys())
            if not keys:
                continue
            diff_count = sum(1 for k in keys if tokens[i].get(k) != tokens[j].get(k))
            diffs.append(diff_count / len(keys))
    return sum(diffs) / len(diffs) if diffs else 0.0


# ------------------- Aggregate Score -------------------

def score_test_case(variants: list[dict], market_lexicons: dict, expected: dict) -> dict:
    """对单个测试用例的全维评分。"""
    results = {
        "market_differentiation": round(market_differentiation(variants), 3),
        "section_order_differentiation": round(section_order_differentiation(variants), 3),
        "design_token_differentiation": round(design_token_differentiation(variants), 3),
        "structural_diversity": structural_diversity(variants),
    }

    # Per-variant metrics
    completeness_scores = []
    procurement_scores = []
    cta_scores = []
    layout_scores = []
    for v in variants:
        market = v.get("market", "")
        completeness_scores.append(required_field_completeness(v, expected.get("required_sections", [])))
        procurement_scores.append(procurement_coverage(v))
        lex = market_lexicons.get(market, {})
        cta_result = cta_compliance(v, lex)
        cta_scores.append(1.0 if cta_result["compliant"] else 0.0)
        layout_scores.append(layout_appropriateness(v, market))

    results["required_field_completeness"] = round(sum(completeness_scores) / len(completeness_scores), 3) if completeness_scores else 0
    results["procurement_coverage"] = round(sum(procurement_scores) / len(procurement_scores), 3) if procurement_scores else 0
    results["cta_compliance"] = round(sum(cta_scores) / len(cta_scores), 3) if cta_scores else 0
    results["layout_appropriateness"] = round(sum(layout_scores) / len(layout_scores), 3) if layout_scores else 0

    return results


def aggregate_results(per_case: list[dict]) -> dict:
    """跨用例聚合(只聚合数值型字段)。"""
    if not per_case:
        return {}
    all_keys = set()
    for r in per_case:
        all_keys.update(k for k, v in r.items() if isinstance(v, (int, float)))
    return {k: round(sum(r.get(k, 0) for r in per_case) / len(per_case), 3) for k in sorted(all_keys)}
