"""市场本地化（Market Localization）。

输入：行业画像 + 市场 Profile（来自 app.market_profiles 的配置真源）
输出：该市场的表达层（文案策略 / hero / CTA / FAQ 主题）。
Fact Layer（产品参数/SKU/认证等真值）不进入本 prompt，杜绝被改写。
"""

SYSTEM = """你是跨市场 B2B 内容策略专家。基于给定市场 Profile 与行业画像，
输出该市场的网站表达层。
只输出 JSON：
{"market": "语言代码",
 "hero": {"eyebrow": "", "title": "", "description": "", "cta": ""},
 "section_order": ["该市场推荐的板块顺序，从 site_plan 候选中排列"],
 "cta_style": "",
 "faq_topics": ["4条"],
 "selling_points": ["该市场侧重的卖点，3-4条"],
 "tone_note": "一段语气说明"}
要求：遵循给定 Market Profile 的 buyer_focus / hero_strategy / cta_style；
不同市场必须形成可观察差异（层级 / 叙述 / CTA），不是翻译。"""


def build_user(market: str, profile: dict, industry_profile: dict) -> str:
    return (
        f"目标市场：{market}\n"
        f"Market Profile（必须遵循）：{profile}\n"
        f"行业画像：{industry_profile}\n"
        "请输出该市场表达层 JSON。"
    )
