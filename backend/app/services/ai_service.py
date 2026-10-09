"""AI 服务层：产品内容生成 / SEO 优化 / Agent 决策。

每个能力都是「真实 LLM 优先，失败或无配置时降级为内置专业模板」，
返回值结构统一，前端无需感知 provider。
"""
from __future__ import annotations

from typing import Any

from .. import llm

# 三语言模板（不是直译：按市场重构措辞与卖点排序）
_MARKET_STYLE = {
    "en": {"brand": "AQUAFLOW", "lead": "Industrial-grade", "tail": "OEM/ODM available with global delivery and commissioning support."},
    "zh": {"brand": "AQUAFLOW", "lead": "面向工业项目", "tail": "支持 OEM/ODM，全球交付与调试支持。"},
    "ru": {"brand": "AQUAFLOW", "lead": "Промышленное оборудование", "tail": "OEM/ODM, поставка и пусконаладка."},
}


def _spec_text(specs: list[dict]) -> str:
    return ", ".join(f"{s.get('key', '')} {s.get('value', '')}".strip() for s in specs if s.get("key"))


def _template_product_content(name: str, model: str, specs: list[dict], applications: list[str]) -> dict[str, Any]:
    """内置专业模板（LLM 不可用时的降级结果）。"""
    spec_text = _spec_text(specs)
    en = _MARKET_STYLE["en"]
    zh = _MARKET_STYLE["zh"]
    ru = _MARKET_STYLE["ru"]
    low = name.lower()

    return {
        "en": {
            "title": f"{name} Manufacturer | AQUAFLOW {model}".strip(),
            "description": (
                f"{en['lead']} {low} engineered for demanding process conditions. "
                f"{spec_text}. {en['tail']}"
            ),
            "benefits": [
                "Stable operation under continuous load",
                "Low maintenance design",
                "Fast global delivery",
            ],
            "faq": [
                "What is the lead time?",
                "Do you provide installation support?",
                "Is OEM / ODM available?",
                "What is the warranty period?",
            ],
            "imageAlt": [f"{name} front view", f"{name} installed on site"],
            "keywords": [low, f"{low} manufacturer", f"{low} supplier", f"industrial {low}"],
        },
        "zh": {
            "title": f"{name} 厂家 | AQUAFLOW {model}".strip(),
            "description": f"{zh['lead']}的 {name}，{spec_text}。{zh['tail']}",
            "benefits": ["连续工况下稳定运行", "低维护设计", "全球快速交付"],
            "faq": ["交货期多久？", "是否提供安装支持？", "是否支持 OEM/ODM？", "质保期多久？"],
            "imageAlt": [f"{name} 正面图", f"{name} 现场安装图"],
            "keywords": [name, f"{name} 厂家", f"{name} 供应商", f"工业 {name}"],
        },
        "ru": {
            "title": f"{name} от производителя | AQUAFLOW {model}".strip(),
            "description": f"{ru['lead']} {name} для тяжёлых условий. {spec_text}. {ru['tail']}",
            "benefits": ["Стабильная работа под нагрузкой", "Низкие затраты на обслуживание", "Быстрая доставка"],
            "faq": ["Срок поставки?", "Техническая поддержка?", "Возможен OEM/ODM?", "Гарантия?"],
            "imageAlt": [f"{name} вид спереди", f"{name} на объекте"],
            "keywords": [name, f"{name} производитель", f"{name} поставщик"],
        },
        "applications": applications,
        "_source": "template",
    }


PRODUCT_SYSTEM = """你是资深外贸 B2B 独立站内容专家，服务工业设备制造企业。
为给定产品生成面向采购商的多语言内容。要求：
1) 三种语言（en/zh/ru）都要输出，且不是直译，需符合当地采购商阅读习惯与搜索习惯；
2) 标题包含产品名、型号、Manufacturer/厂家 等采购意图词；
3) FAQ 必须是真实采购商会问的问题（交期、质保、OEM、安装、认证）；
4) 只输出 JSON，结构为：
{"en":{"title","description","benefits":[],"faq":[],"imageAlt":[],"keywords":[]},
 "zh":{...同结构...}, "ru":{...同结构...}, "applications":[]}"""


async def generate_product_content(
    name: str, model: str, specs: list[dict], applications: list[str]
) -> dict[str, Any]:
    """产品内容生成：真实 LLM 优先，失败降级模板。"""
    user = (
        f"产品名称：{name}\n型号：{model}\n"
        f"参数：{_spec_text(specs) or '（未提供）'}\n"
        f"应用场景：{', '.join(applications) or '（未提供）'}\n"
        "请生成三语言内容。"
    )
    result = await llm.complete_json(PRODUCT_SYSTEM, user)
    if result:
        for lang in ("en", "zh", "ru"):
            if lang not in result:
                break
        else:
            result.setdefault("applications", applications)
            result["_source"] = "llm"
            return result

    return _template_product_content(name, model, specs, applications)


SEO_SYSTEM = """你是外贸 B2B SEO/GEO 专家。为给定产品页输出优化建议。
只输出 JSON：
{"title":"","slug":"","meta_description":"","h1":"","faq":[""],"image_alt":[""],
 "keywords":[""], "internal_links":[""], "schema":["Product","FAQPage"],
 "summary":"一句话说明本次优化为什么能带来询盘"}"""


async def optimize_seo(product: dict) -> dict[str, Any] | None:
    """单产品 SEO/GEO 优化建议（真实 LLM 优先）。"""
    user = (
        f"产品：{product.get('name')} / {product.get('model')}\n"
        f"分类：{product.get('category')}\n"
        f"现有 SEO：{product.get('seo')}\n"
        f"当前分数：SEO {product.get('seo_score')} / GEO {product.get('geo_score')}\n"
        "请给出优化后的字段。"
    )
    return await llm.complete_json(SEO_SYSTEM, user)


AGENT_SYSTEM = """你是外贸独立站运营 Agent。用户用自然语言提出需求。
先判断意图，再输出 JSON：
{"intent":"list_products|list_inquiries|optimize|localize|audit|rollback|unknown",
 "summary":"给用户看的中文结论，1-2 句",
 "rows":[{"field":"","before":"","after":""}]}
只输出 JSON，不要额外解释。"""


async def agent_decide(command: str) -> dict[str, Any] | None:
    """Agent 意图识别与结论生成（真实 LLM 优先）。"""
    return await llm.complete_json(AGENT_SYSTEM, f"用户指令：{command}")


def provider_health() -> dict[str, Any]:
    """AI 能力状态（provider 配置 + 真实调用运行时状态）。"""
    return llm.status()


# ---------------- 页面区块文案改写 ----------------

_PAGE_TEMPLATES = {
    "en-US": {
        "title": "Engineered Flow. Predictable Operations.",
        "subtitle": "Industrial Water Treatment, Delivered",
        "description": "Turnkey treatment systems engineered and commissioned for continuous industrial duty.",
        "cta": "Get a Quote in 24 Hours",
    },
    "ru-RU": {
        "title": "Стабильный поток. Предсказуемая работа.",
        "subtitle": "Промышленная водоочистка под ключ",
        "description": "Комплексные системы водоподготовки с поставкой и пусконаладкой.",
        "cta": "Получить расчёт",
    },
    "zh-CN": {
        "title": "稳定流量，可靠运行",
        "subtitle": "工业水处理，整厂交付",
        "description": "面向连续工业工况的成套水处理系统，含交付与调试。",
        "cta": "24 小时内获取报价",
    },
}

FIELD_LABEL = {"title": "主标题", "subtitle": "副标题", "description": "描述", "cta": "按钮文案"}

PAGE_SYSTEM = """你是外贸 B2B 独立站的首屏文案专家。根据给定的区块与字段，
改写一段更符合采购商搜索意图与当地阅读习惯的文案。
只输出 JSON：{"text": "改写后的文案"}"""

# 无 LLM 时的降级改写：把用户指令里的关键名词并入模板，保证「有指令」与「无指令」
# 产出可见差异，而不是原样返回同一句模板。
_INSTRUCTION_PREFIX = {
    "zh-CN": "关注点：",
    "en-US": "Focus: ",
    "ru-RU": "Акцент: ",
}


def _template_rewrite(field: str, current: str, instruction: str, market: str) -> str:
    tpl = _PAGE_TEMPLATES.get(market or "en-US", _PAGE_TEMPLATES["en-US"])
    base = tpl.get(field) or current or ""
    cleaned = " ".join((instruction or "").split())
    if not cleaned:
        return base

    # 指令过长时截断，避免拼出超长「文案」
    excerpt = cleaned[:40].rstrip("，,。.；;")
    prefix = _INSTRUCTION_PREFIX.get(market or "en-US", _INSTRUCTION_PREFIX["en-US"])
    combined = f"{base}｜{prefix}{excerpt}"
    # 改写结果受 90 字符约束，超长时回到纯模板
    return combined if len(combined) <= 90 else base


async def rewrite_page_copy(
    current: str,
    field: str,
    section_label: str,
    instruction: str = "",
    market: str | None = None,
) -> dict[str, Any]:
    """页面区块文案 AI 改写：真实 LLM 优先，失败降级模板。"""
    mkt = market or "en-US"
    user = (
        f"页面区块：{section_label}\n字段：{FIELD_LABEL.get(field, field)}\n"
        f"当前文案：{current}\n目标市场：{mkt}\n"
        f"额外要求：{instruction or '更贴合 B2B 采购决策，突出可靠性与交付能力'}\n"
        "请给出改写后的文案（不超过 90 字符）。"
    )
    result = await llm.complete_json(PAGE_SYSTEM, user)
    if result and isinstance(result.get("text"), str) and result["text"].strip():
        return {"text": result["text"].strip(), "source": "llm"}

    return {"text": _template_rewrite(field, current, instruction, mkt), "source": "template"}
