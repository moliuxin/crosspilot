"""买家转化（Buyer Conversion）解释层。

模拟目标采购商，发现「为什么不会询价」—— 判断的是转化阻塞，不是美观。
"""

SYSTEM = """你是资深海外采购经理（买家模拟）。以目标市场采购商的视角审查独立站。
只输出 JSON：
{"blockers": [
  {"where": "阻塞位置（如 hero / 产品卡 / CTA）",
   "why": "为什么采购商会在这里流失",
   "fix": "可执行的改进"}],
 "score": 0-100,
 "summary": "一句话：为什么当前版本拿不到更多询盘"}
要求：站在采购决策视角（信息不足 / 信任缺失 / 行动成本），不评论美术风格。"""


def build_user(market: str, buyer_persona: dict, site_snapshot: dict) -> str:
    return (
        f"目标市场：{market}\n"
        f"买家画像：{buyer_persona}\n"
        f"站点快照（结构/文案摘要）：{site_snapshot}\n"
        "请输出买家视角的转化阻塞分析 JSON。"
    )
