"""图片简报（Image Brief）—— AI 图片不靠单个 prompt 乱生成。

产品规则（P0-AI-SITE-GENERATION）：
- 必须先由 GLM 产出结构化 Image Brief（subject / scene / style / composition），
  再交给 GLM-Image；
- prompt 必须同时包含：product_category、market、buyer、template_style、
  visual_style_profile、section_type、image_role；
- 禁止生成：虚假证书 / 客户 Logo / 厂房证明 / 技术铭牌 / 参数截图（AI 不伪造产品事实）；
- 图内不出现文字与 Logo。
"""

SYSTEM = """你是 B2B 网站视觉总监。为网站区块生成结构化图片简报（不是直接画图）。
只输出 JSON：
{"briefs": [{
  "section_type": "hero|applications|capability|cases",
  "image_role": "hero|application_scene|background|market_mood",
  "subject": "画面主体（与产品类别强相关）",
  "scene": "场景（符合目标市场采购语境）",
  "style": "摄影/渲染风格",
  "composition": "构图（如 product left, negative space right）",
  "negative": "no text, no logos, no fabricated certification marks"
}]}
硬约束：
1) subject 必须与用户产品类别直接相关，不得泛化为通用工业图；
2) 不得生成证书、铭牌、参数表、客户 Logo 等事实性元素；
3) scene 与构图按市场 Profile 的 visual_style 调整（zh 偏制造、en 偏产品特写、ru 偏工程现场）。"""


def build_user(
    product_category: str,
    market: str,
    buyer: str,
    template_style: str,
    visual_style_profile: str,
    sections: list[str],
) -> str:
    return (
        f"产品类别：{product_category}\n"
        f"目标市场：{market}\n"
        f"目标买家：{buyer}\n"
        f"模板风格：{template_style}\n"
        f"视觉风格档案：{visual_style_profile}\n"
        f"需要配图的区块：{', '.join(sections)}\n"
        "请输出图片简报 JSON。"
    )


def to_image_prompt(brief: dict, product_category: str, market: str) -> str:
    """把结构化简报组装成图像模型 prompt（包含全部必填上下文）。"""
    parts = [
        f"{market} B2B procurement website visual",
        f"product category: {product_category}",
        f"subject: {brief.get('subject', '')}",
        f"scene: {brief.get('scene', '')}",
        f"style: {brief.get('style', 'premium B2B industrial photography')}",
        f"composition: {brief.get('composition', '')}",
        "no text inside image, no logos",
        "no fabricated certification marks, no fabricated factory evidence",
    ]
    return ", ".join(p for p in parts if p)
