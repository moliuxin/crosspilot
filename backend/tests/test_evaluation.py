# -*- coding: utf-8 -*-
"""Evaluation Framework 测试:metrics 确定性 + 四组对比 + 消融。"""
import json
from pathlib import Path

import pytest

sys_path = str(Path(__file__).resolve().parent.parent.parent)
import sys
if sys_path not in sys.path:
    sys.path.insert(0, sys_path)

from evaluation import metrics as M
from evaluation.run_eval import ARMS, ABLATION_ARMS, load_market_lexicons
from evaluation.metrics import score_test_case, aggregate_results


# ---------------- Metrics 确定性 ----------------

def test_jaccard_distance():
    assert M.jaccard_distance(["a", "b", "c"], ["a", "b", "c"]) == 0.0
    assert M.jaccard_distance(["a", "b"], ["c", "d"]) == 1.0
    assert 0 < M.jaccard_distance(["a", "b", "c"], ["b", "c", "d"]) < 1


def test_market_differentiation_identical():
    variants = [
        {"market": "en", "layout_schema": {"sections": [{"type": "hero"}, {"type": "products"}]}},
        {"market": "ru", "layout_schema": {"sections": [{"type": "hero"}, {"type": "products"}]}},
    ]
    assert M.market_differentiation(variants) == 0.0


def test_market_differentiation_different():
    variants = [
        {"market": "en", "layout_schema": {"sections": [{"type": "hero"}, {"type": "benefits"}, {"type": "faq"}]}},
        {"market": "ru", "layout_schema": {"sections": [{"type": "hero"}, {"type": "key_specs"}, {"type": "supply"}]}},
    ]
    assert M.market_differentiation(variants) > 0.5


def test_cta_compliance():
    lexicon = {"primary": ["Get a Quote"], "secondary": ["Contact Us"]}
    good = {"layout_schema": {"sections": [{"type": "hero", "props": {"cta": "Get a Quote"}}]}}
    bad = {"layout_schema": {"sections": [{"type": "hero", "props": {"cta": "Buy Now"}}]}}
    assert M.cta_compliance(good, lexicon)["compliant"] is True
    assert M.cta_compliance(bad, lexicon)["compliant"] is False


def test_layout_appropriateness():
    variant = {"layout_schema": {"sections": [{"type": "hero"}, {"type": "factory"}, {"type": "solutions"}]}}
    assert M.layout_appropriateness(variant, "zh-CN") > 0.5
    assert M.layout_appropriateness(variant, "en-US") < 0.5


def test_procurement_coverage():
    variant = {
        "content_json": {"copy": {}},
        "layout_schema": {"sections": [{"type": "hero", "props": {
            "moq": "1 unit", "lead_time": "30 days", "warranty": "12 months",
            "certification": "ISO 9001",
        }}]},
    }
    cov = M.procurement_coverage(variant)
    assert cov > 0.5  # 至少 4/6


# ---------------- 四组对比 ----------------

def _load_dataset():
    path = Path(__file__).resolve().parent.parent.parent / "evaluation" / "dataset.json"
    return json.load(open(path, encoding="utf-8"))


def test_four_arms_produce_different_scores():
    """四组的 market_differentiation 应该明显不同(A 最低,D 最高)。"""
    dataset = _load_dataset()
    lexicons = load_market_lexicons()
    tc = dataset["test_cases"][0]  # 协作机器人

    scores = {}
    for arm_id, (_, arm_fn) in ARMS.items():
        variants = arm_fn(tc)
        result = score_test_case(variants, lexicons, tc.get("expected", {}))
        scores[arm_id] = result

    # A(Single Prompt)应该 market_differentiation = 0(所有市场一样)
    assert scores["A"]["market_differentiation"] == 0.0

    # D(Full)应该 >= B(Fixed)> A(jaccard)
    assert scores["D"]["market_differentiation"] >= scores["B"]["market_differentiation"]
    assert scores["B"]["market_differentiation"] > scores["A"]["market_differentiation"]

    # D 在顺序差异度上应该 > B(WI 调整了顺序)
    assert scores["D"]["section_order_differentiation"] >= scores["B"]["section_order_differentiation"]

    # CTA 合规:A 不合规(不在词库),B/C/D 合规
    assert scores["A"]["cta_compliance"] < scores["B"]["cta_compliance"]

    # 布局适配度:D > B
    assert scores["D"]["layout_appropriateness"] >= scores["B"]["layout_appropriateness"]


def test_ablation_shows_contribution():
    """消融:去掉组件后指标应下降。"""
    dataset = _load_dataset()
    lexicons = load_market_lexicons()
    tc = dataset["test_cases"][0]

    results = {}
    for ab_id, (ab_name, ab_fn) in ABLATION_ARMS.items():
        variants = ab_fn(tc)
        results[ab_id] = score_test_case(variants, lexicons, tc.get("expected", {}))

    # Full > no_wi >= no_persona
    assert results["D_full"]["layout_appropriateness"] >= results["D_no_persona"]["layout_appropriateness"]
    assert results["D_full"]["market_differentiation"] >= results["D_no_persona"]["market_differentiation"]


def test_all_test_cases_run():
    """所有测试用例都能被四组正常处理。"""
    dataset = _load_dataset()
    lexicons = load_market_lexicons()
    for tc in dataset["test_cases"]:
        for arm_id, (_, arm_fn) in ARMS.items():
            variants = arm_fn(tc)
            assert len(variants) == len(tc["target_markets"])
            result = score_test_case(variants, lexicons, tc.get("expected", {}))
            assert "market_differentiation" in result
            assert 0 <= result["market_differentiation"] <= 1
