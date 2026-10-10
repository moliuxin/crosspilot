"""Source Discovery:按行业×市场生成检索 Query;支持 SearchProvider 接口与手动 URL。"""
from __future__ import annotations

import abc
from typing import Any


class SearchProvider(abc.ABC):
    """可替换的搜索接口(不要硬编码 Google scraping)。"""

    @abc.abstractmethod
    async def search(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        """返回 [{url, title, domain}]"""


class ManualURLProvider(SearchProvider):
    """用户手动提供 URL(零依赖兜底)。"""

    def __init__(self, urls: list[str] | None = None):
        self._urls = urls or []

    async def search(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        from urllib.parse import urlparse
        return [
            {"url": u, "title": "", "domain": urlparse(u).netloc}
            for u in self._urls[:limit]
        ]


# 行业 × 市场的检索 Query 模板
QUERY_TEMPLATES: dict[str, list[str]] = {
    "en-US": ["{cat} manufacturer", "{cat} supplier B2B", "{cat} factory export",
              "industrial {cat} company", "{cat} solution provider"],
    "ru-RU": ["{cat_ru} производитель", "промышленные {cat_ru} поставщик",
              "{cat_ru} завод", "купить {cat_ru} B2B"],
    "zh-CN": ["{cat_zh}厂家", "{cat_zh}制造商", "工业{cat_zh}供应商",
              "{cat_zh}出口企业", "{cat_zh}解决方案"],
}

# 简单行业翻译(用于俄语/中文 query;完整翻译由 knowledge/industries 提供)
INDUSTRY_RU = {
    "industrial_robotics": "коллаборативные роботы",
    "industrial_machinery": "промышленное оборудование",
    "ai_hardware": "ИИ оборудование",
    "electronics": "электроника",
    "photovoltaic": "солнечные панели",
    "building_materials": "строительные материалы",
    "general_b2b": "промышленный поставщик",
}
INDUSTRY_ZH = {
    "industrial_robotics": "协作机器人",
    "industrial_machinery": "工业机械",
    "ai_hardware": "AI硬件",
    "electronics": "电子产品",
    "photovoltaic": "光伏",
    "building_materials": "建材",
    "general_b2b": "外贸",
}


def generate_queries(industry: str, market: str, product_category: str = "") -> list[str]:
    """按行业+市场生成检索 Query 列表。"""
    templates = QUERY_TEMPLATES.get(market, QUERY_TEMPLATES["en-US"])
    cat_ru = INDUSTRY_RU.get(industry, product_category or "промышленное оборудование")
    cat_zh = INDUSTRY_ZH.get(industry, product_category or "工业设备")
    cat_en = product_category or industry.replace("_", " ")

    queries = []
    for tpl in templates:
        queries.append(tpl.format(cat=cat_en, cat_ru=cat_ru, cat_zh=cat_zh))
    return queries


# 域名过滤(排除新闻/社交/聚合站/marketplace/PDF)
EXCLUDED_DOMAIN_PATTERNS = [
    "wikipedia.org", "youtube.com", "facebook.com", "twitter.com", "x.com",
    "linkedin.com", "instagram.com", "tiktok.com", "reddit.com",
    "amazon.", "alibaba.", "made-in-china.", "globalsources.", "ebay.",
    "news.", "blog.", "medium.com", "quora.",
]

EXCLUDED_URL_PATTERNS = [".pdf", "/login", "/signin", "/signup", "/register"]


def filter_sources(urls: list[dict[str, str]]) -> list[dict[str, str]]:
    """过滤不符合条件的源(新闻/社交/市场平台/PDF/登录页);同 domain 去重。"""
    seen_domains: set[str] = set()
    out = []
    for item in urls:
        url = item.get("url", "").lower()
        domain = item.get("domain", "").lower()
        if not url or not domain:
            continue
        if any(p in domain for p in EXCLUDED_DOMAIN_PATTERNS):
            continue
        if any(p in url for p in EXCLUDED_URL_PATTERNS):
            continue
        if domain in seen_domains:
            continue
        seen_domains.add(domain)
        out.append(item)
    return out


def get_search_provider(manual_urls: list[str] | None = None) -> SearchProvider:
    """工厂:有手动 URL 用手动,否则空(等用户配置 Search API)。"""
    return ManualURLProvider(manual_urls)
