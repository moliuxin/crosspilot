"""Feature Extractor:从 HTML 提取抽象结构/视觉/内容/转化/信任特征(不保存 HTML)。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---- CrossPilot Section Taxonomy ----
SECTION_MAP = {
    "hero": ["hero", "banner", "jumbotron", "main-visual", "kv", "first-view"],
    "benefits": ["benefit", "why-us", "why-choose", "advantage", "value-proposition", "features"],
    "products": ["product", "catalog", "shop", "items", "portfolio"],
    "specs": ["spec", "technical", "parameter", "dimension", "data-sheet"],
    "applications": ["application", "use-case", "industry", "solution", "scenario"],
    "factory": ["factory", "about-us", "company", "manufactur", "workshop", "plant"],
    "supply": ["supply", "delivery", "logistics", "capacity", "production"],
    "certification": ["certif", "iso", "ce-mark", "quality", "compliance", "standard"],
    "cases": ["case", "client", "customer", "success-story", "project", "reference"],
    "services": ["service", "support", "after-sales", "maintenance", "training"],
    "faq": ["faq", "question", "frequent"],
    "contact": ["contact", "email", "phone", "address", "reach"],
    "rfq": ["rfq", "inquiry", "enquiry", "quote", "get-a-", "request-a-"],
    "catalog": ["catalog", "download", "brochure", "pdf"],
    "trust": ["trust", "testimonial", "review", "rating", "partner"],
}

# CTA 归一化
CTA_NORMALIZE = {
    "get_quote": ["get a quote", "request quote", "request a quote", "get pricing", "获取报价", "запросить цену"],
    "contact_sales": ["contact us", "contact sales", "get in touch", "联系我们"],
    "talk_engineer": ["talk to", "speak to", "consult", "chat with", "工程师"],
    "download_catalog": ["download", "catalog", "brochure", "каталог"],
    "request_specs": ["request spec", "datasheet", "технические"],
    "view_products": ["view product", "see product", "browse", "смотреть"],
    "learn_more": ["learn more", "read more", "подробнее", "了解更多"],
    "rfq": ["rfq", "inquiry", "enquiry", "询盘", "оставить заявку"],
}

# 采购字段关键词
PROCUREMENT_KEYWORDS = [
    "moq", "minimum order", "起订",
    "lead time", "delivery time", "交期", "срок",
    "warranty", "guarantee", "质保", "гарантия",
    "certification", "iso", "ce", "certified", "认证",
    "oem", "odm", "customization", "定制",
    "after-sales", "support", "售后",
    "payment", "terms", "付款",
]


def classify_section(text: str) -> str:
    """将 section 文本映射到 CrossPilot taxonomy。"""
    tl = text.lower()
    for sec_type, keywords in SECTION_MAP.items():
        if any(k in tl for k in keywords):
            return sec_type
    return "other"


def normalize_cta(text: str) -> str | None:
    """将 CTA 文本归一化到标准类型。"""
    tl = text.lower().strip()
    for cta_type, patterns in CTA_NORMALIZE.items():
        if any(p in tl for p in patterns):
            return cta_type
    return None


def detect_page_type(url: str, html: str) -> str:
    """识别页面类型。"""
    url_l = url.lower()
    html_l = html.lower()
    if "/product" in url_l and re.search(r'/product[s]?/\w+', url_l):
        return "product_detail"
    if "/product" in url_l or "catalog" in url_l or "shop" in url_l:
        return "product_listing"
    if "/solution" in url_l or "/application" in url_l:
        return "solution"
    if "/case" in url_l or "/project" in url_l or "/client" in url_l:
        return "case_study"
    if "/about" in url_l:
        return "about"
    if "/contact" in url_l:
        return "contact"
    if "/faq" in url_l:
        return "faq"
    # 首页启发
    if "<nav" in html_l and ("hero" in html_l or "banner" in html_l or "main" in html_l):
        return "homepage"
    return "other"


@dataclass
class PageFeatures:
    """一个页面的全部抽象特征(不包含 HTML 原文)。"""
    page_type: str = "other"
    structure: dict = field(default_factory=dict)
    visual: dict = field(default_factory=dict)
    content: dict = field(default_factory=dict)
    conversion: dict = field(default_factory=dict)
    trust: dict = field(default_factory=dict)
    seo: dict = field(default_factory=dict)


def extract_features(html: str, url: str = "") -> PageFeatures:
    """从 HTML 提取全部抽象特征。纯规则,确定性。"""
    pf = PageFeatures()
    pf.page_type = detect_page_type(url, html)
    pf.structure = _extract_structure(html)
    pf.visual = _extract_visual(html)
    pf.content = _extract_content(html)
    pf.conversion = _extract_conversion(html)
    pf.trust = _extract_trust(html)
    pf.seo = _extract_seo(html, url)
    return pf


def _extract_structure(html: str) -> dict:
    """结构特征:导航数/hero/section 序列/粘性导航等。"""
    # 导航链接数
    nav_links = len(re.findall(r'<nav[^>]*>.*?</nav>', html, re.DOTALL))
    nav_items = len(re.findall(r'<li[^>]*>\s*<a', html))

    # Hero 检测
    hero_present = bool(re.search(
        r'class="[^"]*(hero|banner|jumbotron|kv|main-visual)[^"]*"', html, re.I))
    hero_height = 0
    m = re.search(r'(?:min-height|height)\s*:\s*(\d{2,4})px', html[:8000])
    if m:
        hero_height = int(m.group(1))

    # Section 检测(简化:按 h2/h3 标题分类)
    headings = re.findall(r'<h[23][^>]*>(.*?)</h[23]>', html, re.DOTALL | re.I)
    headings = [re.sub(r'<[^>]+>', '', h).strip()[:80] for h in headings]
    sections = [classify_section(h) for h in headings if h]

    # 粘性导航
    sticky_nav = bool(re.search(r'(?:position:\s*sticky|position:\s*fixed)', html[:3000], re.I))

    # 浮动联系
    floating_contact = bool(re.search(
        r'class="[^"]*(float|fixed|sticky|whatsapp|live-chat)[^"]*"', html, re.I))

    # 页脚复杂度
    footer_links = len(re.findall(r'<footer[^>]*>.*?</footer>', html, re.DOTALL))

    return {
        "navigation_count": nav_items,
        "hero_present": hero_present,
        "hero_height_px": hero_height,
        "hero_height_ratio": round(hero_height / 1080, 2) if hero_height else 0,
        "section_count": len(sections),
        "section_types": sections[:20],
        "section_order": [s for s in sections if s != "other"][:15],
        "sticky_nav": sticky_nav,
        "floating_contact": floating_contact,
        "footer_complexity": min(footer_links, 3),
    }


def _extract_visual(html: str) -> dict:
    """视觉特征(抽象):背景明暗/边框圆角/阴影/渐变/字体。"""
    css_inline = " ".join(re.findall(r'style="([^"]*)"', html))
    css_all = html  # 简化:整个 HTML 搜索

    # 背景明暗
    dark_bg = len(re.findall(r'background[^>]*#[0-2][0-9a-f]{5}', css_all, re.I))
    light_bg = len(re.findall(r'background[^>]*#[e-f][0-9a-f]{5}', css_all, re.I))

    # 圆角
    border_radius = 0
    m = re.search(r'border-radius\s*:\s*(\d+)', css_all)
    if m:
        border_radius = int(m.group(1))

    # 阴影
    shadows = len(re.findall(r'box-shadow', css_all))

    # 渐变
    gradients = len(re.findall(r'linear-gradient|radial-gradient', css_all))

    # 字体大小分布(粗略)
    font_sizes = [int(x) for x in re.findall(r'font-size\s*:\s*(\d+)px', css_all) if int(x) > 0]

    return {
        "background_lightness": "light" if light_bg > dark_bg else ("dark" if dark_bg > 3 else "mixed"),
        "border_radius_category": "none" if border_radius == 0 else ("small" if border_radius <= 4 else "medium" if border_radius <= 12 else "large"),
        "shadow_strength": min(shadows, 3),
        "gradient_usage": min(gradients, 5),
        "glassmorphism_presence": bool(re.search(r'backdrop-filter|blur\(', css_all, re.I)),
        "heading_scale": max(font_sizes) if font_sizes else 0,
        "body_density": len(re.findall(r'<p[ >]', html)),
        "image_count": len(re.findall(r'<img[ >]', html)),
        "image_text_ratio": round(len(re.findall(r'<img[ >]', html)) / max(len(re.findall(r'<p[ >]', html)), 1), 2),
    }


def _extract_content(html: str) -> dict:
    """内容特征:密度/标题长度/技术词密度/采购字段。"""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    words = text.split()

    headings = [re.sub(r'<[^>]+>', '', h).strip() for h in
                re.findall(r'<h[12][^>]*>(.*?)</h[12]>', html, re.DOTALL | re.I)]

    # 采购字段检测
    text_l = text.lower()
    procurement_found = [k for k in PROCUREMENT_KEYWORDS if k in text_l]

    # FAQ 数量
    faq_count = len(re.findall(r'<details|class="[^"]*faq|accordion', html, re.I))

    # 技术参数密度(数字+单位出现频次)
    tech_terms = len(re.findall(r'\d+\s*(?:kg|mm|cm|m|kw|v|a|hz|mpa|bar|°c|n|m³|l)', text, re.I))

    return {
        "content_density": min(len(words) // 100, 10),
        "headline_length": len(headings[0].split()) if headings else 0,
        "technical_term_density": min(tech_terms // 5, 10),
        "faq_count": faq_count,
        "procurement_fields_present": procurement_found,
        "procurement_coverage": len(procurement_found) / len(PROCUREMENT_KEYWORDS),
        "has_description": len(text) > 500,
    }


def _extract_conversion(html: str) -> dict:
    """转化特征:CTA 类型/位置/频率;询盘表单。"""
    # 提取所有按钮/链接文本
    btn_texts = re.findall(r'<(?:button|a)[^>]*>(.*?)</(?:button|a)>', html, re.DOTALL | re.I)
    btn_texts = [re.sub(r'<[^>]+>', '', b).strip()[:50] for b in btn_texts if b.strip()]

    ctas = []
    for bt in btn_texts:
        n = normalize_cta(bt)
        if n:
            ctas.append({"type": n, "text": bt})

    # 询盘表单
    has_form = bool(re.search(r'<form[^>]*', html))
    form_fields = len(re.findall(r'<input|<textarea|<select', html))

    # CTA 在前半页还是后半页
    first_cta_pos = html.lower().find(ctas[0]["text"].lower()) if ctas else -1
    cta_position = "above_fold" if first_cta_pos != -1 and first_cta_pos < len(html) // 4 else \
                   "mid_page" if first_cta_pos != -1 else "unknown"

    return {
        "cta_count": len(ctas),
        "cta_types": list({c["type"] for c in ctas})[:8],
        "primary_cta": ctas[0]["type"] if ctas else None,
        "cta_position": cta_position,
        "cta_frequency": min(len(ctas), 5),
        "rfq_form_present": has_form and any("rfq" in c["type"] or "inquiry" in c["type"] or "quote" in c["type"] for c in ctas),
        "form_fields_count": min(form_fields, 10),
    }


def _extract_trust(html: str) -> dict:
    """信任特征:认证/案例/工厂/质保/技术支持(只判断'有没有')。"""
    # 先剥离 HTML 标签,只对可见文本做关键词匹配(避免 <ul>/<ce> 等标签误触发)
    visible = re.sub(r'<[^>]+>', ' ', html)
    visible = re.sub(r'\s+', ' ', visible).lower()

    return {
        "certification_presence": any(
            re.search(rf'\b{re.escape(k)}', visible) for k in
            ["iso", "certif", "ce mark", "ce certified", "tuv", "ul listed", "eac", "gost"]
        ),
        "customer_logo_presence": bool(re.search(r'class="[^"]*(client|partner|logo-wall|brand)[^"]*"', html, re.I)),
        "case_presence": any(k in visible for k in ["case", "project", "success", "reference"]),
        "factory_presence": any(k in visible for k in ["factory", "plant", "workshop", "manufactur"]),
        "warranty_presence": any(k in visible for k in ["warranty", "guarantee", "质保"]),
        "technical_support_presence": any(k in visible for k in ["support", "after-sales", "service"]),
    }


def _extract_seo(html: str, url: str = "") -> dict:
    """SEO 特征:title/description/schema/hreflang。"""
    title = ""
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL | re.I)
    if m:
        title = re.sub(r'<[^>]+>', '', m.group(1)).strip()[:80]

    desc = ""
    m = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]*)"', html, re.I)
    if m:
        desc = m.group(1)[:160]

    schemas = re.findall(r'"@type"\s*:\s*"(\w+)"', html)
    hreflangs = re.findall(r'hreflang="([^"]*)"', html)
    canonical = bool(re.search(r'rel="canonical"', html))

    return {
        "title": title,
        "title_length": len(title),
        "meta_description": bool(desc),
        "schema_types": list(set(schemas))[:5],
        "hreflang": hreflangs,
        "canonical": canonical,
        "h1_count": len(re.findall(r'<h1[ >]', html)),
    }
