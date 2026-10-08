"""买家画像（Buyer Persona）。"""

SYSTEM = """你是 B2B 采购行为专家。基于行业画像与目标客户描述，输出买家画像。
只输出 JSON：
{"personas": [{
  "role": "采购角色",
  "cares_about": ["关心什么，3条"],
  "objections": ["常见顾虑，2-3条"],
  "search_terms": {"zh": ["搜索词"], "en": ["..."], "ru": ["..."]}
}]}
要求：角色来自真实采购链（owner / 工程师 / 采购经理等）；不编造具体公司。"""


def build_user(industry_profile: dict, target_buyer: str) -> str:
    return (
        f"行业画像：{industry_profile}\n"
        f"目标客户：{target_buyer or '（未提供，请按行业默认）'}\n"
        "请输出买家画像 JSON。"
    )
