# -*- coding: utf-8 -*-
"""WI 第二/三批测试:Similarity Guard / WebsiteIntelligenceSkill / Service 流程。"""
import pytest

from app.website_intelligence.similarity_guard import (
    sequence_similarity, check_similarity, suggest_variation, SIMILARITY_THRESHOLD,
)


# ---------------- Similarity Guard ----------------

def test_identical_sequences_high_similarity():
    a = ["hero", "benefits", "products", "certification", "faq", "rfq"]
    b = ["hero", "benefits", "products", "certification", "faq", "rfq"]
    sim = sequence_similarity(a, b)
    assert sim > 0.95


def test_different_sequences_low_similarity():
    a = ["hero", "benefits", "applications", "products", "certification", "faq", "rfq"]
    b = ["hero", "key_specs", "supply_capability", "products", "services", "rfq"]
    sim = sequence_similarity(a, b)
    assert sim < 0.6


def test_check_similarity_passes_for_different():
    new_layout = [{"type": t} for t in ["hero", "key_specs", "products", "services", "faq", "rfq"]]
    sources = [
        ["hero", "benefits", "applications", "products", "certification", "faq", "rfq"],
        ["hero", "factory", "solutions", "products", "specs", "cases", "rfq"],
    ]
    result = check_similarity(new_layout, sources)
    assert result["pass"] is True
    assert result["max_similarity"] < SIMILARITY_THRESHOLD


def test_check_similarity_fails_for_too_similar():
    new_layout = [{"type": t} for t in ["hero", "benefits", "products", "certification", "faq", "rfq"]]
    sources = [
        ["hero", "benefits", "products", "certification", "faq", "rfq"],
        ["hero", "factory", "solutions", "rfq"],
    ]
    result = check_similarity(new_layout, sources)
    assert result["pass"] is False
    assert result["action"] == "replan_needed"
    assert result["most_similar_source"] == 0


def test_suggest_variation_changes_order():
    layout = [
        {"type": "hero"}, {"type": "benefits"}, {"type": "products"},
        {"type": "certification"}, {"type": "rfq"},
    ]
    similar = ["hero", "benefits", "products", "certification", "rfq"]
    varied = suggest_variation(layout, similar)
    seq = [s["type"] for s in varied]
    assert seq != [s["type"] for s in layout]  # 顺序变了
    assert seq[0] == "hero"  # hero 不动
    assert seq[-1] == "rfq"  # rfq 不动


def test_normalize_filters_other():
    from app.website_intelligence.similarity_guard import _normalize_sequence
    assert _normalize_sequence(["hero", "other", "products", "other", "rfq"]) == ["hero", "products", "rfq"]
    assert _normalize_sequence(["hero", "hero", "products", "rfq"]) == ["hero", "products", "rfq"]


# ---------------- WebsiteIntelligenceSkill 注册 ----------------

def test_wi_skill_registered():
    import app.skills  # noqa
    from app.skills import registry
    skill = registry.get("website_intelligence")
    assert skill is not None
    assert skill.id == "website_intelligence"
    assert "product_category" in skill.input_schema.get("required", [])


# ---------------- Market Profile 融合(集成检查) ----------------

def test_market_design_profile_influences_layout():
    """Profile 的 layout_patterns 应能影响 LayoutPlanning(非硬编码)。"""
    from app.website_intelligence.pattern_aggregator import aggregate

    # 模拟 EN 市场数据:applications 前置率高
    snaps = []
    for i in range(6):
        snaps.append({
            "_domain": f"site{i}.com",
            "structure": {
                "hero_present": True, "hero_height_ratio": 0.4,
                "section_count": 6,
                "section_order": ["hero", "applications", "products", "certification", "faq", "rfq"],
                "sticky_nav": True, "floating_contact": False, "footer_complexity": 1,
            },
            "visual": {"background_lightness": "light", "border_radius_category": "medium",
                       "gradient_usage": 2, "glassmorphism_presence": False,
                       "image_count": 8, "image_text_ratio": 0.6},
            "content": {"headline_length": 6, "technical_term_density": 4,
                        "procurement_coverage": 0.5, "faq_count": 3},
            "conversion": {"primary_cta": "get_quote", "cta_types": ["get_quote", "view_products"],
                           "rfq_form_present": True, "cta_frequency": 3},
            "trust": {"certification_presence": True, "case_presence": True,
                      "factory_presence": False, "warranty_presence": True},
            "seo": {"schema_types": ["Organization"], "hreflang": [], "canonical": True},
        })

    profile = aggregate(snaps, "industrial_robotics", "en-US")
    layout = profile["layout_patterns"]

    # applications 应在前 3(section_priority)
    top_sections = set(layout["section_priority"].keys())
    assert "applications" in top_sections
    assert "products" in top_sections

    # CTA 应以 get_quote 为主
    cta = profile["cta_patterns"]
    assert "get_quote" in cta["primary_cta"]


# ---------------- Similarity Guard 集成到生成链 ----------------

def test_similarity_guard_in_generation_pipeline():
    """生成链的最后一关:确保与 Source 不过于相似。"""
    from app.website_intelligence.similarity_guard import check_similarity

    # 模拟:LayoutPlanning 输出 + Source layouts
    generated = [
        {"type": "hero", "id": "sec_hero"},
        {"type": "key_specs", "id": "sec_specs"},
        {"type": "products", "id": "sec_products"},
        {"type": "supply_capability", "id": "sec_supply"},
        {"type": "services", "id": "sec_services"},
        {"type": "rfq", "id": "sec_rfq"},
    ]
    source_layouts = [
        ["hero", "benefits", "applications", "products", "certification", "faq", "rfq"],
        ["hero", "factory", "solutions", "products", "specs", "cases", "rfq"],
        ["hero", "key_specs", "supply", "products", "tech", "services", "faq", "rfq"],
    ]
    result = check_similarity(generated, source_layouts)
    assert result["pass"] is True
    assert result["action"] == "ok"
