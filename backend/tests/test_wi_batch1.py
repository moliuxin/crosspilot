# -*- coding: utf-8 -*-
"""Website Intelligence 第一批测试:Feature Extractor / Pattern Aggregator / Profile Builder。"""
import pytest

from app.website_intelligence.feature_extractor import (
    extract_features, detect_page_type, classify_section, normalize_cta,
)
from app.website_intelligence.pattern_aggregator import aggregate
from app.website_intelligence.source_discovery import generate_queries, filter_sources
from app.website_intelligence.profile_builder import build_and_save


# ---- 合成测试 HTML(不抓真实网页,确定性) ----

def make_b2b_html(title="Industrial Robot Manufacturer", cta="Get a Quote",
                  bg="#0a1a30", sections=("Products", "Applications", "Certification", "Contact"),
                  specs=True, iso=True):
    sec_html = "".join(
        f'<section><h2>{s}</h2><p>Content about {s.lower()} for B2B buyers.</p></section>'
        for s in sections
    )
    specs_html = '<table><tr><td>Payload</td><td>10 kg</td></tr><tr><td>Reach</td><td>1300 mm</td></tr></table>' if specs else ""
    iso_html = '<div>ISO 9001 CE Certified</div>' if iso else ""
    return f'''<!DOCTYPE html>
<html><head><title>{title}</title>
<meta name="description" content="B2B manufacturer">
<script type="application/ld+json">{{"@type":"Organization"}}</script>
</head><body style="background:{bg}">
<nav style="position:sticky"><ul><li><a>Home</a></li><li><a>About</a></li><li><a>Products</a></li></ul></nav>
<section class="hero" style="min-height:600px"><h1>{title}</h1><a href="#" class="btn">{cta}</a></section>
{sec_html}{specs_html}{iso_html}
<footer><p>© 2026 Company</p></footer>
</body></html>'''


# ---------------- Source Discovery ----------------

def test_generate_queries_en():
    qs = generate_queries("industrial_robotics", "en-US", "collaborative robot")
    assert len(qs) >= 4
    assert any("collaborative robot" in q for q in qs)


def test_generate_queries_ru():
    qs = generate_queries("industrial_robotics", "ru-RU")
    assert any("коллаборативные" in q or "робот" in q for q in qs)


def test_filter_sources_excludes_social():
    sources = [
        {"url": "https://example.com/products", "domain": "example.com"},
        {"url": "https://facebook.com/page", "domain": "facebook.com"},
        {"url": "https://example.com/about", "domain": "example.com"},  # 同域去重
        {"url": "https://good-site.com/doc.pdf", "domain": "good-site.com"},  # PDF 排除
    ]
    out = filter_sources(sources)
    assert len(out) == 1
    assert out[0]["domain"] == "example.com"


# ---------------- Feature Extractor ----------------

def test_extract_structure_deterministic():
    html = make_b2b_html()
    r1 = extract_features(html, "https://example.com/")
    r2 = extract_features(html, "https://example.com/")
    assert r1.structure == r2.structure
    assert r1.conversion == r2.conversion


def test_structure_features():
    html = make_b2b_html()
    f = extract_features(html, "https://example.com/")
    st = f.structure
    assert st["hero_present"] is True
    assert st["section_count"] >= 3
    assert st["sticky_nav"] is True
    assert "products" in st["section_types"]
    assert "certification" in st["section_types"]


def test_page_type_detection():
    assert detect_page_type("https://example.com/products/robot-1", "") == "product_detail"
    assert detect_page_type("https://example.com/products", "") == "product_listing"
    assert detect_page_type("https://example.com/", make_b2b_html()) == "homepage"


def test_cta_normalization():
    assert normalize_cta("Get a Quote") == "get_quote"
    assert normalize_cta("Request a quote") == "get_quote"
    assert normalize_cta("Contact Us") == "contact_sales"
    assert normalize_cta("Скачать каталог") == "download_catalog"
    assert normalize_cta("Random text") is None


def test_trust_features():
    html = make_b2b_html(iso=True)
    f = extract_features(html, "")
    assert f.trust["certification_presence"] is True

    html_no_iso = make_b2b_html(iso=False, sections=("Products", "Applications", "About", "Contact"))
    f2 = extract_features(html_no_iso, "")
    assert f2.trust["certification_presence"] is False


def test_procurement_fields():
    html = make_b2b_html() + "<p>MOQ: 1 unit. Lead Time: 30 days. Warranty: 12 months.</p>"
    f = extract_features(html, "")
    assert "moq" in f.content["procurement_fields_present"]
    assert "lead time" in f.content["procurement_fields_present"]
    assert f.content["procurement_coverage"] > 0


# ---------------- Pattern Aggregator ----------------

def _make_snapshots(n=5, variations=False):
    """生成 n 个合成 snapshot。"""
    snaps = []
    for i in range(n):
        sections = ["Products", "Applications", "Certification", "Contact"]
        cta = "Get a Quote"
        bg = "#0a1a30"
        if variations and i % 2 == 0:
            sections = ["Solutions", "Products", "About Us", "FAQ"]
            cta = "Contact Us"
            bg = "#f0f6ff"
        html = make_b2b_html(cta=cta, bg=bg, sections=tuple(sections))
        f = extract_features(html, f"https://site{i}.com/")
        snaps.append({
            "_domain": f"site{i}.com",
            "structure": f.structure,
            "visual": f.visual,
            "content": f.content,
            "conversion": f.conversion,
            "trust": f.trust,
            "seo": f.seo,
        })
    return snaps


def test_aggregate_5_sources():
    snaps = _make_snapshots(5)
    result = aggregate(snaps, "industrial_robotics", "en-US")
    assert result["sample_size"] == 5
    assert result["confidence"]["level"] in ("medium", "high")
    assert "layout_patterns" in result
    assert result["layout_patterns"]["hero_pattern"]
    assert result["cta_patterns"]["primary_cta"]
    assert "source_domains" in result


def test_aggregate_low_confidence():
    result = aggregate(_make_snapshots(2), "industrial_robotics", "en-US")
    assert result["confidence"]["level"] == "low"
    assert "warning" in result


def test_aggregate_layout_priority():
    snaps = _make_snapshots(6)
    result = aggregate(snaps, "industrial_robotics", "en-US")
    top = result["layout_patterns"]["section_priority"]
    assert any(k in top for k in ("products", "applications", "certification"))


# ---------------- Profile Builder ----------------

def test_profile_builder_saves(client):
    """BuyerConversionReport 和 MarketDesignProfile 建表正常。"""
    from app.database import Base, engine
    # 表已由 create_all 创建;直接用 SessionLocal
    from app.database import SessionLocal
    from app.website_intelligence import models as wi_m

    db = SessionLocal()
    try:
        snaps = _make_snapshots(5)
        profile = build_and_save(db, tenant_id=1, research_project_id="test_rp",
                                 industry="industrial_robotics", market="en-US",
                                 snapshots=snaps)
        assert profile is not None
        assert profile.sample_size == 5
        assert profile.industry == "industrial_robotics"
        assert profile.layout_patterns.get("hero_pattern")
        assert profile.confidence.get("level") in ("medium", "high")
        assert len(profile.source_domains) == 5

        # 缓存:再次获取同 industry+market 应命中
        cached = build_and_save(db, tenant_id=1, research_project_id="test_rp2",
                                industry="industrial_robotics", market="en-US",
                                snapshots=_make_snapshots(3))  # 更少样本 → 不覆盖
        assert cached.id == profile.id
    finally:
        db.close()
