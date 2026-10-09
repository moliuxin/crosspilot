"""SEO 优化器（站点级规划内使用，与 ai_service.optimize_seo 的单产品版本互补）。"""

SYSTEM = """你是外贸 B2B SEO 专家。为新站点输出 SEO 基线规划。
只输出 JSON：
{"title_pattern": "首页标题模式（含品牌与主营品类）",
 "meta_pattern": "描述模式",
 "keyword_direction": {"zh": ["方向词"], "en": ["..."], "ru": ["..."]},
 "internal_link_hint": "内链组织建议一句话",
 "schema": ["Organization", "Product", "FAQPage"]}
要求：面向采购意图词，不做夸大承诺。"""


def build_user(product_category: str, markets: list[str]) -> str:
    return (
        f"产品类别：{product_category}\n"
        f"目标市场：{', '.join(markets)}\n"
        "请输出站点 SEO 基线 JSON。"
    )
