"""Buyer Conversion Readiness 服务(P0-8 规范 6.2-6.5)。

- collect_page_data():从 变体区块 + 站点 + 产品事实 采集规则引擎输入
  (可见区块与真实事实,不做任何编造);
- analyze_variant():规则评分(+可选 GLM 语义微调)→ BuyerConversionReport 落库;
- build_improvement_draft():按缺失字段从产品事实中找真实值生成 Draft
  (找不到事实时拒绝 —— 绝不编造 MOQ/交期)。

Readiness Score ≠ 成交概率;衡量页面信息完备度对采购商决策的支撑程度。
"""
from __future__ import annotations

import logging

from .. import models
from ..knowledge import market_knowledge
from ..utils import new_id

logger = logging.getLogger(__name__)

# 电商话术黑名单(规范:CTA 不得是电商心智)
ECOMMERCE_CTA_BAN = {"buy now", "add to cart", "checkout", "shop now", "立即购买", "加入购物车"}

# 采购信息字段 → 在 section props 中的常见键名别名
_PROCUREMENT_KEYS = {
    "moq": ("moq", "起订量", "min_order"),
    "lead_time": ("lead_time", "交期", "delivery_time", "货期"),
    "warranty": ("warranty", "质保", "保修"),
    "payment_terms": ("payment_terms", "付款方式", "payment"),
    "shipping": ("shipping", "物流", "运输"),
}


def _walk_props(sections: list[dict]) -> dict:
    """展平所有区块 props(键统一小写)。"""
    flat: dict = {}
    for s in sections or []:
        for k, v in (s.get("props") or {}).items():
            flat[str(k).lower()] = v
    return flat


def _find_procurement(flat: dict) -> dict:
    out = {}
    for canonical, aliases in _PROCUREMENT_KEYS.items():
        # 同时识别规范键(moq)与改进草稿写入键(procurement_moq)
        candidates = (canonical, f"procurement_{canonical}") + aliases
        for a in candidates:
            v = flat.get(a)
            if v and (str(v).strip() or isinstance(v, (int, float))):
                out[canonical] = str(v)
                break
    return out


def collect_page_data(db, tenant_id: int, site, variant, products: list) -> dict:
    """规则引擎输入采集:产品事实(只读)+ 变体可见区块 + 市场词库。"""
    sections = (variant.layout_schema or {}).get("sections", [])
    flat = _walk_props(sections)
    types = [s.get("type") for s in sections]
    sec = lambda t: next((s for s in sections if s.get("type") == t), None)  # noqa: E731

    p = (products or [None])[0]
    page: dict = {
        "name": (p.name if p else "") or site.product_category or site.name or "",
        "model": p.model if p else "",
        "specs": (p.specs if p else []) or [],
        "applications": (p.applications if p else []) or [],
        "benefits": (p.benefits if p else []) or [],
        "description": (p.description if p else "") or "",
        "company_name": site.name or "",
        "factory_info": (sec("factory") or {}).get("props", {}).get("description", ""),
    }
    # 采购信息:区块 props 中的真实明示值
    page.update(_find_procurement(flat))
    # 认证:认证墙区块 items / 产品字段
    cert_items = (sec("certifications") or {}).get("props", {}).get("items") or []
    cert_items = cert_items or (p.certifications if p and hasattr(p, "certifications") else []) or []
    page["certifications"] = cert_items
    # 案例:仅真实案例算信任证据(AI 概念展示不算 —— 诚实原则)
    case_sec = sec("cases")
    if case_sec and not (case_sec.get("props") or {}).get("concept"):
        page["cases"] = (case_sec.get("props") or {}).get("items") or ["case-section"]
    else:
        page["cases"] = []

    # CTA:hero 主 CTA + 词库校验
    mk = market_knowledge(variant.market) or {}
    lexicon = [str(x).lower() for x in
               (mk.get("cta", {}).get("primary", []) + mk.get("cta", {}).get("secondary", []))]
    hero_cta = str(((sec("hero") or {}).get("props") or {}).get("cta", "") or
                   (variant.content_json or {}).get("copy", {}).get("hero", {}).get("cta", ""))
    page["cta_in_lexicon"] = bool(hero_cta) and hero_cta.lower() in lexicon
    page["cta_no_ecommerce"] = bool(hero_cta) and hero_cta.lower() not in ECOMMERCE_CTA_BAN
    fast_quote = sec("fast_quote") or sec("cta")
    page["secondary_cta"] = ((fast_quote or {}).get("props") or {}).get("label", "") or \
                            ((sec("rfq") or {}).get("props") or {}).get("submit_label", "")

    # RFQ 便利性
    rfq = (sec("rfq") or {}).get("props") or {}
    page["rfq_form"] = "rfq" in types
    page["contact_email"] = rfq.get("email", "") or rfq.get("contact_email", "")
    page["response_time"] = rfq.get("response_time", "") or rfq.get("sla", "")
    channels = {rfq.get("email"), rfq.get("phone"), rfq.get("form_label") or rfq.get("title")}
    page["multiple_channels"] = sum(1 for c in channels if c) >= 2
    fields = rfq.get("fields") or []
    page["form_fields_min"] = len(fields) >= 4 if isinstance(fields, list) else False
    return page


async def analyze_variant(db, tenant_id: int, site, variant, products: list,
                          use_semantic: bool = True) -> models.BuyerConversionReport:
    """评分 → 落库 → 返回报告行。规则层确定性;语义层经 BuyerConversionSkill(可选 ±10)。"""
    from ..skills.buyer_conversion import BuyerConversionSkill, score_all
    from ..skills.base import SkillContext

    page = collect_page_data(db, tenant_id, site, variant, products)
    result = score_all(page)
    provider, model_name = "rule_engine", ""
    result["market"] = variant.market
    result["note"] = "Readiness Score ≠ 成交概率;衡量页面信息完备度对采购商决策的支撑程度。"

    if use_semantic:
        try:
            skill = BuyerConversionSkill()
            ctx = SkillContext(tenant_id=tenant_id, site_id=site.id, market=variant.market)
            sem = await skill.execute(ctx, {"page_data": page, "market": variant.market})
            if sem.output.get("ai_source") == "rule_engine+glm":
                result["dimension_scores"] = sem.output["dimension_scores"]
                result["overall_score"] = sem.output["overall_score"]
                result["semantic_note"] = sem.output.get("semantic_note", "")
                provider, model_name = "rule_engine+glm", sem.output.get("model", "") or "glm"
        except Exception as exc:  # noqa: BLE001 — 语义层不可用时保持纯规则结果
            logger.warning("buyer conversion 语义层不可用,保持规则层:%s", str(exc)[:80])

    report = models.BuyerConversionReport(
        id=new_id("bcr"), tenant_id=tenant_id, site_id=site.id, market=variant.market,
        variant_id=variant.id,
        overall_score=result["overall_score"],
        dimension_scores=result["dimension_scores"],
        evidence=result["evidence"],
        missing_information=result["missing_information"],
        recommendations=result["recommendations"],
        rule_version=result.get("rule_version", "1.0.0"),
        provider=provider, model=model_name,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def build_improvement_draft(db, tenant_id: int, site, variant, products: list,
                            report: models.BuyerConversionReport) -> tuple[models.Draft | None, list[str]]:
    """按报告缺失项从**产品真实事实**生成改进 Draft;无事实可用时拒绝(不编造)。

    返回 (Draft|None, 命中说明列表)。改进只写 procurement_information 维度:
    把产品/站点里真实存在的 MOQ/交期/质保/付款/物流 明示到 RFQ 区块 props。
    """
    sections = (variant.layout_schema or {}).get("sections", [])
    rfq = next((s for s in sections if s.get("type") == "rfq"), None)
    if rfq is None:
        return None, ["该变体无 RFQ 区块,改进草稿不适用"]

    # 事实来源 1:产品 specs 结构化条目({key:"MOQ", value:"1 set"} 或 "MOQ: 1 set")
    facts: dict[str, str] = {}
    for p in products or []:
        for item in (p.specs or []):
            if isinstance(item, dict):
                key = str(item.get("key", ""))
                s = f"{key}: {item.get('value', '')}".strip(": ")
            else:
                s = str(item)
            low = s.lower()
            for canonical, aliases in _PROCUREMENT_KEYS.items():
                if canonical in facts:
                    continue
                if any(a in low or a in s for a in aliases):
                    facts[canonical] = s
    # 事实来源 2:其它区块已明示但 RFQ 区块未汇总的采购信息
    flat = _walk_props(sections)
    for canonical in _PROCUREMENT_KEYS:
        if canonical in facts:
            continue
        for a in _PROCUREMENT_KEYS[canonical]:
            v = flat.get(a)
            if v and str(v).strip():
                facts[canonical] = str(v)
                break

    applied = []
    new_props = dict(rfq.get("props") or {})
    for canonical, value in facts.items():
        key = f"procurement_{canonical}"
        if not new_props.get(key):
            new_props[key] = value
            applied.append(f"{key} = {value[:40]}")
    if not applied:
        return None, ["无可用采购事实(产品/区块中未找到 MOQ/交期/质保等),拒绝编造"]

    old_props = dict(rfq.get("props") or {})
    diff = [{"field": k, "before": old_props.get(k, ""), "after": v}
            for k, v in new_props.items() if old_props.get(k, "") != v]
    draft = models.Draft(
        id=new_id("draft"), tenant_id=tenant_id, site_id=site.id,
        title=f"Buyer Conversion 改进 · {variant.market} 采购信息明示",
        entity_type="market_variant", entity_id=variant.id,
        market=variant.market, diff=diff,
        patch={"sections": {rfq["id"]: {"props": new_props}}},
        selection={"source": "buyer_conversion", "report_id": report.id},
        status="pending",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft, applied
