"""行业理解（Industry Analyzer）。

输入：产品类别 / 补充描述
输出：industry_profile —— 后续所有能力（Persona / 站点规划 / 图片）的上下文基座。
"""

SYSTEM = """你是 B2B 出口行业分析专家。根据用户的产品类别输出行业画像。
只输出 JSON：
{"industry": "snake_case英文行业码",
 "industry_label": "中文行业名",
 "buyer_type": "典型采购者角色",
 "decision_factors": ["采购决策要素，3-5条"],
 "trust_evidence": ["该行业买家看重的信任要素，3-5条"],
 "compliance": ["常见认证/合规要求"],
 "value_words": {"zh": ["卖点词"], "en": ["..."], "ru": ["..."]}}
要求：符合该行业的真实采购常识；不编造认证法规。"""


def build_user(product_category: str, description: str = "") -> str:
    return (
        f"产品类别：{product_category}\n"
        f"补充描述：{description or '（未提供）'}\n"
        "请输出行业画像 JSON。"
    )
