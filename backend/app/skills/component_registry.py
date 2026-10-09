"""Component Registry(PHASE 5):组件元数据真源 + 市场默认布局。

React 端 src/components/site-blocks/ 按 type 渲染;GLM 只输出
{type, variant, props},不输出 HTML。这里声明每个组件的能力与
asset 槽位(供 PHASE 8 Asset Slot System 消费)。
"""

COMPONENTS: dict[str, dict] = {
    "hero": {
        "name": "Hero(首屏)",
        "variants": ["industrial", "minimal", "technical-dark"],
        "default_variant": "industrial",
        "supported_markets": ["*"],
        "supported_industries": ["*"],
        "asset_slots": [{"slot": "hero", "required": True, "type": "image"}],
    },
    "benefits": {
        "name": "Benefits(利益点)",
        "variants": ["grid"],
        "default_variant": "grid",
        "supported_markets": ["en-US", "zh-CN"],
        "asset_slots": [],
    },
    "factory": {
        "name": "FactoryStrength(制造能力)",
        "variants": ["stats", "story"],
        "default_variant": "stats",
        "supported_markets": ["zh-CN"],
        "asset_slots": [{"slot": "factory", "required": False, "type": "image"}],
    },
    "key_specs": {
        "name": "KeySpecs(关键参数)",
        "variants": ["table", "cards"],
        "default_variant": "table",
        "supported_markets": ["ru-RU", "zh-CN"],
        "asset_slots": [],
    },
    "applications": {
        "name": "Applications(应用场景)",
        "variants": ["grid", "scenes"],
        "default_variant": "grid",
        "supported_markets": ["*"],
        "asset_slots": [{"slot": "application_scene", "required": False, "type": "image", "repeat": 3}],
    },
    "solutions": {
        "name": "Solutions(解决方案)",
        "variants": ["list"],
        "default_variant": "list",
        "supported_markets": ["zh-CN"],
        "asset_slots": [],
    },
    "products": {
        "name": "Products(产品系列)",
        "variants": ["cards", "specs"],
        "default_variant": "cards",
        "supported_markets": ["*"],
        "asset_slots": [{"slot": "product_cover", "required": False, "type": "image", "repeat": 3}],
    },
    "supply_capability": {
        "name": "SupplyCapability(供货能力)",
        "variants": ["stats"],
        "default_variant": "stats",
        "supported_markets": ["ru-RU"],
        "asset_slots": [],
    },
    "technical_details": {
        "name": "TechnicalDetails(技术细节)",
        "variants": ["table"],
        "default_variant": "table",
        "supported_markets": ["ru-RU"],
        "asset_slots": [],
    },
    "certifications": {
        "name": "CertificationGrid(认证墙)",
        "variants": ["grid"],
        "default_variant": "grid",
        "supported_markets": ["*"],
        "asset_slots": [],
    },
    "cases": {
        "name": "CaseStudyGrid(案例)",
        "variants": ["grid"],
        "default_variant": "grid",
        "supported_markets": ["*"],
        "asset_slots": [{"slot": "case", "required": False, "type": "image", "repeat": 3}],
    },
    "services": {
        "name": "Services(服务承诺)",
        "variants": ["cards"],
        "default_variant": "cards",
        "supported_markets": ["ru-RU", "en-US"],
        "asset_slots": [],
    },
    "faq": {
        "name": "FAQ",
        "variants": ["accordion"],
        "default_variant": "accordion",
        "supported_markets": ["*"],
        "asset_slots": [],
    },
    "fast_quote": {
        "name": "FastQuote(快速询价)",
        "variants": ["band"],
        "default_variant": "band",
        "supported_markets": ["en-US"],
        "asset_slots": [],
    },
    "rfq": {
        "name": "RFQ(询盘表单)",
        "variants": ["form"],
        "default_variant": "form",
        "supported_markets": ["*"],
        "asset_slots": [],
    },
    "trust": {
        "name": "TrustStrip(信任条)",
        "variants": ["strip"],
        "default_variant": "strip",
        "supported_markets": ["*"],
        "asset_slots": [],
    },
}

# 各市场默认 Section 顺序(PHASE 6 的默认 Profile;生成后持久化为 SiteMarketVariant)
MARKET_DEFAULT_SECTIONS: dict[str, list[dict]] = {
    "zh-CN": [
        {"type": "hero"}, {"type": "factory"}, {"type": "solutions"},
        {"type": "products"}, {"type": "key_specs"}, {"type": "certifications"},
        {"type": "cases"}, {"type": "rfq"},
    ],
    "en-US": [
        {"type": "hero"}, {"type": "benefits"}, {"type": "applications"},
        {"type": "products"}, {"type": "certifications"}, {"type": "faq"},
        {"type": "fast_quote"},
    ],
    "ru-RU": [
        {"type": "hero"}, {"type": "key_specs"}, {"type": "supply_capability"},
        {"type": "products"}, {"type": "technical_details"}, {"type": "services"},
        {"type": "faq"}, {"type": "rfq"},
    ],
}


def layout_for_market(market: str, industry: dict | None = None) -> list[dict]:
    """市场默认布局;行业 sections_priority 存在时按其重排交集部分。"""
    base = [dict(s) for s in MARKET_DEFAULT_SECTIONS.get(market, MARKET_DEFAULT_SECTIONS["en-US"])]
    if industry:
        priority = industry.get("layout_hints", {}).get("sections_priority")
        if priority:
            # 只重排默认布局中已有的 type(不引入行业不支持的组件)
            order = {t: i for i, t in enumerate(priority)}
            base.sort(key=lambda s: order.get(s["type"], 99))
    return base
