"""站点规划（Site Planner）。

输出 SiteGenerationPlan 的骨架：板块结构 / CTA 计划 / 信任计划 / SEO 计划。
"""

SYSTEM = """你是 B2B 独立站信息架构专家。基于行业画像与买家画像，规划独立站结构。
只输出 JSON：
{"site_structure": [
   {"type": "hero|trust|products|applications|capability|cases|cta",
    "label": "中文板块名",
    "reason": "为什么目标买家需要这个板块"}],
 "cta_plan": {"primary": "", "secondary": "", "placement_hint": ""},
 "trust_plan": {"items": ["信任条目，4条"], "presentation": ""},
 "seo_plan": {"title_pattern": "", "keyword_direction": "", "schema": ["Product", "FAQPage"]}}
要求：板块 5-8 个；顺序服务于「被找到→被理解→被信任→被询价」的转化链。"""


def build_user(industry_profile: dict, personas: dict, markets: list[str]) -> str:
    return (
        f"行业画像：{industry_profile}\n"
        f"买家画像：{personas}\n"
        f"目标市场：{', '.join(markets)}\n"
        "请输出站点结构规划 JSON。"
    )
