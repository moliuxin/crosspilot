"""提示词资产（单一真源，禁止写死在 React 里）。

P0-AI-SITE-GENERATION 规则：每个能力一个模块，各自声明
- SYSTEM prompt
- 输入构造器 build_user()
- 输出 JSON schema 说明

LLM 调用统一走 app.llm.complete_json；失败/未配置时由
services.site_generation 的降级模板接管，保证演示不中断。
"""

from . import (  # noqa: F401
    buyer_conversion,
    buyer_persona,
    image_brief,
    industry_analyzer,
    market_localization,
    seo_optimizer,
    site_planner,
)
