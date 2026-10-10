"""Pattern Aggregator:多源统计聚合 → MarketDesignProfile(带置信度)。"""
from __future__ import annotations

from collections import Counter
from typing import Any


def aggregate(snapshots: list[dict[str, Any]], industry: str, market: str) -> dict:
    """聚合多个 FeatureSnapshot → Market Design Profile。

    每个结论附 support_count/sample_size/confidence。
    """
    n = len(snapshots)
    if n < 3:
        return _low_confidence(n, industry, market)

    # ---- Layout ----
    layout = _agg_layout(snapshots, n)
    # ---- Visual ----
    visual = _agg_visual(snapshots, n)
    # ---- Content ----
    content = _agg_content(snapshots, n)
    # ---- CTA ----
    cta = _agg_cta(snapshots, n)
    # ---- Trust ----
    trust = _agg_trust(snapshots, n)
    # ---- Image ----
    image = _agg_image(snapshots, n)
    # ---- SEO ----
    seo = _agg_seo(snapshots, n)
    # ---- 置信度 ----
    confidence = _confidence(n, snapshots)

    return {
        "industry": industry,
        "market": market,
        "sample_size": n,
        "layout_patterns": layout,
        "visual_patterns": visual,
        "content_patterns": content,
        "cta_patterns": cta,
        "trust_patterns": trust,
        "image_patterns": image,
        "seo_patterns": seo,
        "confidence": confidence,
        "source_domains": sorted({s.get("_domain", "") for s in snapshots if s.get("_domain")}),
    }


def _freq(items: list, n: int) -> dict:
    c = Counter(items)
    return {k: {"count": v, "ratio": round(v / n, 2)} for k, v in c.most_common(10)}


def _agg_layout(snaps: list[dict], n: int) -> dict:
    hero_types = Counter()
    section_orders = []
    density_scores = []
    sticky_count = 0
    floating_contact_count = 0

    for s in snaps:
        st = s.get("structure", {})
        if st.get("hero_present"):
            hr = st.get("hero_height_ratio", 0)
            hero_types["full_screen" if hr > 0.6 else "split" if hr > 0.3 else "compact"] += 1
        section_orders.append(st.get("section_order", []))
        density_scores.append(st.get("section_count", 0))
        if st.get("sticky_nav"):
            sticky_count += 1
        if st.get("floating_contact"):
            floating_contact_count += 1

    # 统计各 section 出现在前 3 的频率
    top3_freq = Counter()
    for order in section_orders:
        for sec in order[:3]:
            top3_freq[sec] += 1

    avg_density = sum(density_scores) / n if n else 0

    return {
        "hero_pattern": {k: {"count": v, "ratio": round(v / n, 2)} for k, v in hero_types.most_common(3)},
        "section_priority": {k: {"count": v, "ratio": round(v / n, 2)} for k, v in top3_freq.most_common(8)},
        "density": "high" if avg_density > 7 else "medium" if avg_density > 4 else "low",
        "avg_section_count": round(avg_density, 1),
        "sticky_nav": {"count": sticky_count, "ratio": round(sticky_count / n, 2)},
        "floating_contact": {"count": floating_contact_count, "ratio": round(floating_contact_count / n, 2)},
    }


def _agg_visual(snaps: list[dict], n: int) -> dict:
    bg = Counter()
    radius = Counter()
    gradients = []
    glass_count = 0

    for s in snaps:
        v = s.get("visual", {})
        bg[v.get("background_lightness", "mixed")] += 1
        radius[v.get("border_radius_category", "unknown")] += 1
        gradients.append(v.get("gradient_usage", 0))
        if v.get("glassmorphism_presence"):
            glass_count += 1

    return {
        "background": dict(bg.most_common(3)),
        "border_radius": dict(radius.most_common(3)),
        "avg_gradient_usage": round(sum(gradients) / n, 1),
        "glassmorphism_ratio": round(glass_count / n, 2),
    }


def _agg_content(snaps: list[dict], n: int) -> dict:
    headline_lens = []
    tech_densities = []
    procurement_covs = []
    faq_counts = []

    for s in snaps:
        c = s.get("content", {})
        headline_lens.append(c.get("headline_length", 0))
        tech_densities.append(c.get("technical_term_density", 0))
        procurement_covs.append(c.get("procurement_coverage", 0))
        faq_counts.append(c.get("faq_count", 0))

    avg_headline = sum(headline_lens) / n
    avg_tech = sum(tech_densities) / n
    avg_proc = sum(procurement_covs) / n
    avg_faq = sum(faq_counts) / n

    return {
        "headline_style": "concise" if avg_headline < 8 else "detailed",
        "avg_headline_words": round(avg_headline, 1),
        "technical_density": "high" if avg_tech > 5 else "medium" if avg_tech > 2 else "low",
        "procurement_coverage": round(avg_proc, 2),
        "avg_faq_count": round(avg_faq, 1),
        "benefit_vs_spec": "spec_heavy" if avg_tech > 4 else "balanced" if avg_tech > 2 else "benefit_heavy",
    }


def _agg_cta(snaps: list[dict], n: int) -> dict:
    primary_ctas = []
    all_ctas = []
    rfq_form_count = 0
    cta_freqs = []

    for s in snaps:
        conv = s.get("conversion", {})
        if conv.get("primary_cta"):
            primary_ctas.append(conv["primary_cta"])
        all_ctas.extend(conv.get("cta_types", []))
        if conv.get("rfq_form_present"):
            rfq_form_count += 1
        cta_freqs.append(conv.get("cta_frequency", 0))

    return {
        "primary_cta": dict(Counter(primary_ctas).most_common(3)),
        "cta_distribution": dict(Counter(all_ctas).most_common(8)),
        "rfq_form_ratio": round(rfq_form_count / n, 2),
        "avg_cta_frequency": round(sum(cta_freqs) / n, 1),
    }


def _agg_trust(snaps: list[dict], n: int) -> dict:
    trust_counts = Counter()
    for s in snaps:
        t = s.get("trust", {})
        for k, v in t.items():
            if v:
                trust_counts[k.replace("_presence", "")] += 1
    return {k: {"count": v, "ratio": round(v / n, 2)} for k, v in trust_counts.most_common(8)}


def _agg_image(snaps: list[dict], n: int) -> dict:
    img_counts = []
    img_text_ratios = []
    for s in snaps:
        v = s.get("visual", {})
        img_counts.append(v.get("image_count", 0))
        img_text_ratios.append(v.get("image_text_ratio", 0))
    return {
        "avg_image_count": round(sum(img_counts) / n, 1),
        "avg_image_text_ratio": round(sum(img_text_ratios) / n, 2),
        "image_richness": "high" if sum(img_counts) / n > 10 else "medium" if sum(img_counts) / n > 5 else "low",
    }


def _agg_seo(snaps: list[dict], n: int) -> dict:
    schema_types = []
    hreflang_count = 0
    canonical_count = 0
    for s in snaps:
        seo = s.get("seo", {})
        schema_types.extend(seo.get("schema_types", []))
        if seo.get("hreflang"):
            hreflang_count += 1
        if seo.get("canonical"):
            canonical_count += 1
    return {
        "schema_types": dict(Counter(schema_types).most_common(5)),
        "hreflang_ratio": round(hreflang_count / n, 2),
        "canonical_ratio": round(canonical_count / n, 2),
    }


def _confidence(n: int, snaps: list[dict]) -> dict:
    domains = {s.get("_domain", "") for s in snaps}
    diversity = len(domains)
    overall = "high" if n >= 8 and diversity >= 5 else "medium" if n >= 5 and diversity >= 3 else "low"
    return {
        "level": overall,
        "sample_size": n,
        "source_diversity": diversity,
        "note": "LOW CONFIDENCE — 样本不足,不可作为市场研究结论" if n < 3 else
                "INSUFFICIENT DIVERSITY — 来源单一" if diversity < 2 else
                f"Based on {n} sources from {diversity} domains",
    }


def _low_confidence(n: int, industry: str, market: str) -> dict:
    return {
        "industry": industry,
        "market": market,
        "sample_size": n,
        "confidence": {"level": "low", "sample_size": n, "source_diversity": 0,
                       "note": f"Only {n} sources — insufficient for market conclusions"},
        "warning": "LOW CONFIDENCE: 需要至少 3 个来源才能生成有效 Market Design Profile",
    }
