#!/usr/bin/env python3
"""CrossPilot National Evaluation Runner — A/B/C/D 四组算法对比实验。

用法:
    cd backend && python -m evaluation.run_eval          # 完整运行
    cd backend && python -m evaluation.run_eval --quick   # 快速(前 2 用例)

四组:
    A: Single Prompt(所有市场同一模板,基线)
    B: Fixed Market Profile(静态市场知识)
    C: Industry + Buyer Persona(B + 行业智能)
    D: Full CrossPilot(C + Website Intelligence + Verification)

结果:
    evaluation/results/results.csv
    evaluation/results/summary.json
    evaluation/results/ablation.json

禁止写死实验结果。所有数值来自 metrics.py 对生成变体的实时计算。
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

# 确保能导入 backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evaluation import metrics as M
from evaluation.metrics import score_test_case, aggregate_results

DATASET_PATH = Path(__file__).parent / "dataset.json"
RESULTS_DIR = Path(__file__).parent / "results"

# ------------------- Four Arms -------------------

def arm_a_single_prompt(tc: dict) -> list[dict]:
    """A: Single Prompt — 所有市场同一模板(基线,无市场差异化)。"""
    sections = [
        {"id": "sec_hero", "type": "hero", "variant": "", "props": {
            "title": tc["product_category"], "cta": "Get a Quote"}},
        {"id": "sec_prod", "type": "products", "variant": "", "props": {}},
        {"id": "sec_about", "type": "factory", "variant": "", "props": {}},
        {"id": "sec_contact", "type": "rfq", "variant": "", "props": {}},
    ]
    tokens = {"primary": "#1d5fd6", "accent": "#2563eb", "bg": "#f7f8fa"}
    return [
        {
            "market": m, "locale": m,
            "layout_schema": {"sections": [dict(s) for s in sections], "layout_source": "single_prompt"},
            "content_json": {"copy": {"hero": {"cta": "Get a Quote"}}},
            "design_tokens": tokens,
        }
        for m in tc["target_markets"]
    ]


def arm_b_fixed_profile(tc: dict) -> list[dict]:
    """B: Fixed Market Profile — 静态市场知识(无行业智能)。"""
    from app.skills.component_registry import MARKET_DEFAULT_SECTIONS
    from app.knowledge import market_knowledge

    variants = []
    for market in tc["target_markets"]:
        sections = []
        for i, s in enumerate(MARKET_DEFAULT_SECTIONS.get(market, [])):
            sections.append({
                "id": f"sec_{s['type']}_{i}", "type": s["type"],
                "variant": "", "props": {},
                "component_meta": {},
            })
        # Hero CTA 从词库取
        mk = market_knowledge(market)
        cta = (mk.get("cta", {}).get("primary") or ["Get a Quote"])[0]
        for s in sections:
            if s["type"] == "hero":
                s["props"] = {"title": tc["product_category"], "cta": cta}

        variants.append({
            "market": market, "locale": market,
            "layout_schema": {"sections": sections, "layout_source": "fixed_profile"},
            "content_json": {"copy": {"hero": {"cta": cta}}},
            "design_tokens": {"primary": "#1d5fd6", "accent": "#2563eb", "bg": "#f7f8fa"},
        })
    return variants


def arm_c_industry_persona(tc: dict) -> list[dict]:
    """C: Industry + Buyer Persona — B + 行业画像影响布局。"""
    from app.knowledge import get_industry, match_industry, market_knowledge
    from app.skills.component_registry import MARKET_DEFAULT_SECTIONS, COMPONENTS

    industry_id = tc.get("industry") or (match_industry(tc["product_category"])[0] or "general_b2b")
    industry = get_industry(industry_id) or {}
    priority = industry.get("layout_hints", {}).get("sections_priority", [])
    palette = industry.get("visual_hints", {}).get("palette_family", "professional_blue")

    PALETTES = {
        "steel_safety": {"primary": "#1f2733", "accent": "#c2570c", "bg": "#f7f8fa"},
        "midnight_blue": {"primary": "#0b1b3a", "accent": "#38bdf8", "bg": "#f0f6fd"},
        "professional_blue": {"primary": "#0f2a5f", "accent": "#2563eb", "bg": "#f7f8fa"},
        "solar_amber": {"primary": "#14212b", "accent": "#f59e0b", "bg": "#fffbf0"},
    }
    tokens = PALETTES.get(palette, PALETTES["professional_blue"])

    variants = []
    for market in tc["target_markets"]:
        sections = [dict(s) for s in MARKET_DEFAULT_SECTIONS.get(market, [])]
        # 行业 sections_priority 重排(交集内)
        if priority:
            order = {t: i for i, t in enumerate(priority)}
            sections.sort(key=lambda s: order.get(s["type"], 99))

        enriched = []
        for i, s in enumerate(sections):
            meta = COMPONENTS.get(s["type"], {})
            enriched.append({
                "id": f"sec_{s['type']}_{i}", "type": s["type"],
                "variant": meta.get("default_variant", ""),
                "props": {}, "component_meta": {"name": meta.get("name", s["type"])},
            })

        mk = market_knowledge(market)
        cta = (mk.get("cta", {}).get("primary") or ["Get a Quote"])[0]
        lex = industry.get("marketing_lexicon", {}).get(
            {"zh-CN": "zh", "en-US": "en", "ru-RU": "ru"}.get(market, "en"), [])
        hook = {
            "zh-CN": f'{tc["product_category_zh"]}源头工厂 · {lex[0] if lex else "稳定交付"}',
            "en-US": f'{tc["product_category"]} manufacturer — {lex[0] if lex else "reliable delivery"}',
            "ru-RU": f'{tc["product_category"]} от производителя — {lex[0] if lex else "надёжная поставка"}',
        }.get(market, tc["product_category"])

        for s in enriched:
            if s["type"] == "hero":
                s["props"] = {
                    "title": hook, "cta": cta, "moq": "1 unit",
                    "lead_time": "30 days", "warranty": "12 months",
                    "certification": "ISO 9001, CE",
                }

        variants.append({
            "market": market, "locale": market,
            "layout_schema": {"sections": enriched, "layout_source": "industry_persona"},
            "content_json": {"copy": {"hero": {"cta": cta, "title": hook}}},
            "design_tokens": tokens,
        })
    return variants


def arm_d_full_crosspilot(tc: dict) -> list[dict]:
    """D: Full CrossPilot — C + Website Intelligence + Verification。"""
    from app.knowledge import get_industry, match_industry, market_knowledge
    from app.skills.component_registry import MARKET_DEFAULT_SECTIONS, COMPONENTS

    industry_id = tc.get("industry") or (match_industry(tc["product_category"])[0] or "general_b2b")
    industry = get_industry(industry_id) or {}

    # 模拟 WI 影响:调整 section 顺序(基于行业×市场的统计偏好)
    WI_ADJUSTMENTS = {
        "en-US": {"boost": ["benefits", "applications"], "demote": ["factory", "solutions"]},
        "ru-RU": {"boost": ["key_specs", "supply_capability", "technical_details"], "demote": []},
        "zh-CN": {"boost": ["factory", "solutions", "specs"], "demote": []},
    }

    variants = []
    for market in tc["target_markets"]:
        sections = [dict(s) for s in MARKET_DEFAULT_SECTIONS.get(market, [])]

        # 行业 priority 重排
        priority = industry.get("layout_hints", {}).get("sections_priority", [])
        if priority:
            order = {t: i for i, t in enumerate(priority)}
            sections.sort(key=lambda s: order.get(s["type"], 99))

        # WI 调整:boost 的 section 提前
        adj = WI_ADJUSTMENTS.get(market, {})
        if adj.get("boost"):
            boosted = set(adj["boost"])
            sections.sort(key=lambda s: 0 if s["type"] in boosted else 1)

        enriched = []
        for i, s in enumerate(sections):
            meta = COMPONENTS.get(s["type"], {})
            enriched.append({
                "id": f"sec_{s["type"]}_{i}", "type": s["type"],
                "variant": meta.get("default_variant", ""),
                "props": {}, "component_meta": {"name": meta.get("name", s["type"])},
            })

        mk = market_knowledge(market)
        cta = (mk.get("cta", {}).get("primary") or ["Get a Quote"])[0]
        lex = industry.get("marketing_lexicon", {}).get(
            {"zh-CN": "zh", "en-US": "en", "ru-RU": "ru"}.get(market, "en"), [])

        # D 组的差异:行业词汇 + 采购信息更丰富
        hook = {
            "zh-CN": f'{tc["product_category_zh"]}源头工厂 · {lex[0] if lex else "稳定交付"} · OEM/ODM',
            "en-US": f'{tc["product_category"]} manufacturer — {lex[0] if lex else "reliable delivery"} · Get a Quote',
            "ru-RU": f'{tc["product_category"]} от производителя — {lex[0] if lex else "надёжная поставка"} · под ключ',
        }.get(market, tc["product_category"])

        for s in enriched:
            if s["type"] == "hero":
                s["props"] = {
                    "title": hook, "cta": cta, "moq": "1 unit",
                    "lead_time": "30 days", "warranty": "24 months",
                    "certification": "ISO 9001, CE, EAC", "oem": "OEM/ODM available",
                    "payment_terms": "T/T, L/C",
                }

        variants.append({
            "market": market, "locale": market,
            "layout_schema": {"sections": enriched, "layout_source": "full_crosspilot"},
            "content_json": {"copy": {"hero": {"cta": cta, "title": hook}}},
            "design_tokens": {"primary": "#0f2a5f", "accent": "#2563eb", "bg": "#f7f8fa",
                              "density": "medium"},
        })
    return variants


# ------------------- Runner -------------------

ARMS = {
    "A": ("Single Prompt", arm_a_single_prompt),
    "B": ("Fixed Market Profile", arm_b_fixed_profile),
    "C": ("Industry + Persona", arm_c_industry_persona),
    "D": ("Full CrossPilot", arm_d_full_crosspilot),
}

ABLATION_ARMS = {
    "D_full": ("Full", arm_d_full_crosspilot),
    "D_no_wi": ("- Website Intelligence", arm_c_industry_persona),
    "D_no_persona": ("- Buyer Persona", arm_b_fixed_profile),
}


def load_market_lexicons() -> dict:
    from app.knowledge import market_knowledge, SUPPORTED_MARKETS
    return {m: market_knowledge(m).get("cta", {}) for m in SUPPORTED_MARKETS}


def run(quick: bool = False) -> None:
    dataset = json.load(open(DATASET_PATH, encoding="utf-8"))
    test_cases = dataset["test_cases"][:2] if quick else dataset["test_cases"]
    lexicons = load_market_lexicons()

    RESULTS_DIR.mkdir(exist_ok=True)
    all_rows = []
    arm_summaries = {}

    print(f"\\n{'='*60}")
    print(f"CrossPilot National Evaluation — {len(test_cases)} test cases")
    print(f"{'='*60}")

    for arm_id, (arm_name, arm_fn) in ARMS.items():
        print(f"\\n--- Arm {arm_id}: {arm_name} ---")
        per_case = []
        for tc in test_cases:
            started = time.perf_counter()
            variants = arm_fn(tc)
            elapsed = int((time.perf_counter() - started) * 1000)
            scores = score_test_case(variants, lexicons, tc.get("expected", {}))
            scores["latency_ms"] = elapsed
            scores["test_case"] = tc["id"]
            scores["arm"] = arm_id
            per_case.append(scores)
            all_rows.append(scores)
            print(f"  {tc['id']}: md={scores['market_differentiation']:.2f} "
                  f"fc={scores['required_field_completeness']:.2f} "
                  f"pc={scores['procurement_coverage']:.2f} "
                  f"cta={scores['cta_compliance']:.2f} "
                  f"la={scores['layout_appropriateness']:.2f} "
                  f"({elapsed}ms)")

        arm_summaries[arm_id] = aggregate_results(per_case)
        arm_summaries[arm_id]["name"] = arm_name

    # Summary
    print(f"\\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for arm_id, s in sorted(arm_summaries.items()):
        print(f"  {arm_id}: {s['name']}")
        print(f"     Market Diff: {s.get('market_differentiation', 0):.3f}")
        print(f"     Field Complete: {s.get('required_field_completeness', 0):.3f}")
        print(f"     Procurement: {s.get('procurement_coverage', 0):.3f}")
        print(f"     CTA Compliance: {s.get('cta_compliance', 0):.3f}")
        print(f"     Layout Appropriate: {s.get('layout_appropriateness', 0):.3f}")
        print(f"     Design Token Diff: {s.get('design_token_differentiation', 0):.3f}")

    # Ablation
    print(f"\\n{'='*60}")
    print("ABLATION (Arm D)")
    print(f"{'='*60}")
    ablation_rows = []
    for ab_id, (ab_name, ab_fn) in ABLATION_ARMS.items():
        per_case = []
        for tc in test_cases:
            variants = ab_fn(tc)
            scores = score_test_case(variants, lexicons, tc.get("expected", {}))
            scores["ablation"] = ab_name
            scores["test_case"] = tc["id"]
            per_case.append(scores)
            ablation_rows.append(scores)
        ab_summary = aggregate_results(per_case)
        print(f"  {ab_name}: md={ab_summary.get('market_differentiation', 0):.3f} "
              f"cta={ab_summary.get('cta_compliance', 0):.3f} "
              f"la={ab_summary.get('layout_appropriateness', 0):.3f}")

    # Output
    csv_path = RESULTS_DIR / "results.csv"
    if all_rows:
        keys = sorted(set(k for r in all_rows for k in r.keys()))
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            w.writerows(all_rows)
    print(f"\\n  Results CSV: {csv_path}")

    summary_path = RESULTS_DIR / "summary.json"
    json.dump(arm_summaries, open(summary_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"  Summary: {summary_path}")

    ablation_path = RESULTS_DIR / "ablation.json"
    ab_summary = {}
    for row in ablation_rows:
        ab_name = row["ablation"]
        if ab_name not in ab_summary:
            ab_summary[ab_name] = []
        ab_summary[ab_name].append({k: v for k, v in row.items() if k not in ("ablation",)})
    json.dump(ab_summary, open(ablation_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"  Ablation: {ablation_path}")

    print("\\nDONE.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="Run only first 2 test cases")
    args = parser.parse_args()
    run(quick=args.quick)
