"""Buyer Conversion Readiness Engine(P0-8)—— 真实规则算法,非硬编码分数。

五维(0-100):
  product_clarity        产品名/型号/规格/应用场景是否齐备
  trust_evidence         认证/案例/公司信息是否可信
  procurement_information MOQ/交期/质保/付款方式是否明示
  cta_clarity            CTA 是否在词库内、是否 B2B RFQ 心智
  rfq_convenience        询盘表单字段/联系方式/响应承诺

规则层确定性:同输入同输出(测试断言)。
GLM 语义层:仅当真实模型可用时对 clarity 维度 ±10 调整(标注 ai_source)。
"""
from __future__ import annotations

from .. import knowledge
from .base import Skill, SkillContext, SkillResult
from .registry import register

# 各维度的规则检查项:(字段路径, 权重, 检查类型)
RULES = {
    "product_clarity": [
        ("name", 25, "nonempty"),       # 产品名
        ("model", 15, "nonempty"),      # 型号
        ("specs", 25, "list_nonempty"), # 技术参数
        ("applications", 15, "list_nonempty"), # 应用场景
        ("description", 10, "nonempty"),       # 描述
        ("benefits", 10, "list_nonempty"),     # 卖点
    ],
    "trust_evidence": [
        ("certifications", 30, "list_nonempty"),  # 认证
        ("cases", 25, "list_nonempty"),            # 案例
        ("company_name", 15, "nonempty"),          # 公司名
        ("factory_info", 15, "nonempty"),          # 工厂信息
        ("warranty", 15, "nonempty"),              # 质保
    ],
    "procurement_information": [
        ("moq", 30, "nonempty"),          # 起订量
        ("lead_time", 25, "nonempty"),    # 交期
        ("warranty", 20, "nonempty"),     # 质保
        ("payment_terms", 15, "nonempty"),# 付款方式
        ("shipping", 10, "nonempty"),     # 物流
    ],
    "cta_clarity": [
        ("cta_in_lexicon", 50, "bool_true"),  # CTA 在市场词库
        ("cta_no_ecommerce", 30, "bool_true"),# 无电商话术
        ("secondary_cta", 20, "nonempty"),    # 有次 CTA
    ],
    "rfq_convenience": [
        ("rfq_form", 30, "bool_true"),        # 有询盘表单
        ("contact_email", 20, "nonempty"),    # 联系邮箱
        ("response_time", 20, "nonempty"),    # 响应时间承诺
        ("multiple_channels", 15, "bool_true"), # 多渠道(邮件+电话+表单)
        ("form_fields_min", 15, "bool_true"),   # 表单字段 ≥4
    ],
}

DIMENSION_LABELS = {
    "product_clarity": "产品清晰度",
    "trust_evidence": "信任证据",
    "procurement_information": "采购信息",
    "cta_clarity": "CTA 清晰度",
    "rfq_convenience": "询盘便利性",
}


def _check(value, check_type: str) -> bool:
    if check_type == "nonempty":
        return bool(value and str(value).strip())
    if check_type == "list_nonempty":
        return bool(value and (isinstance(value, list) and len(value) > 0 or str(value).strip()))
    if check_type == "bool_true":
        return value is True
    return False


def score_dimension(data: dict, dim: str) -> tuple[int, list[dict], list[str]]:
    """纯规则层评分(确定性)。返回 (score, evidence, missing)。"""
    rules = RULES.get(dim, [])
    if not rules:
        return 0, [], []
    score = 0
    evidence = []
    missing = []
    for field, weight, check in rules:
        ok = _check(data.get(field), check)
        if ok:
            score += weight
            evidence.append({"field": field, "present": True, "weight": weight})
        else:
            missing.append(field)
            evidence.append({"field": field, "present": False, "weight": weight})
    return score, evidence, missing


def score_all(data: dict) -> dict:
    """规则层全维评分。确定性:同输入同输出。"""
    dims = {}
    all_missing = []
    for dim in RULES:
        s, ev, missing = score_dimension(data, dim)
        dims[dim] = {"score": s, "evidence": ev, "missing": missing}
        all_missing.extend(missing)
    overall = round(sum(d["score"] for d in dims.values()) / len(dims))
    recommendations = _recommendations(dims)
    return {
        "overall_score": overall,
        "dimension_scores": {k: v["score"] for k, v in dims.items()},
        "evidence": {k: v["evidence"] for k, v in dims.items()},
        "missing_information": sorted(set(all_missing)),
        "recommendations": recommendations,
        "rule_version": "1.0.0",
    }


def _recommendations(dims: dict) -> list[dict]:
    recs = []
    for dim, info in dims.items():
        if info["score"] < 60:
            label = DIMENSION_LABELS.get(dim, dim)
            top_missing = info["missing"][:3]
            recs.append({
                "dimension": dim,
                "dimension_label": label,
                "priority": "high" if info["score"] < 40 else "medium",
                "action": f"补充 {label} 维度缺失字段:{', '.join(top_missing)}",
                "expected_lift": min(40, 100 - info["score"]),
            })
    return sorted(recs, key=lambda r: r["priority"] == "high", reverse=True)


class BuyerConversionSkill(Skill):
    id = "buyer_conversion"
    name = "Buyer Conversion Readiness"
    version = "1.0.0"
    description = "五维采购转化准备度评估(规则引擎,非硬编码)。同输入确定性输出。"
    credits = 0
    input_schema = {"required": ["page_data"]}
    output_schema = {"required": ["overall_score", "dimension_scores"]}

    async def execute(self, context: SkillContext, data: dict) -> SkillResult:
        page_data = data.get("page_data") or {}
        market = data.get("market") or context.market or "en-US"

        # 规则层(确定性)
        result = score_all(page_data)
        result["market"] = market
        result["ai_source"] = "rule_engine"
        result["note"] = "Readiness Score ≠ 成交概率;衡量的是页面信息完备度对采购商决策的支撑程度。"

        # GLM 语义层(可选:真实模型可用时,仅微调 product_clarity ±10)
        try:
            from .. import llm
            semantic = await llm.complete_json(
                "你是B2B采购转化评估专家。分析页面数据的采购商可读性。只输出JSON:{\"clarity_adjustment\": -10到10, \"reason\": \"一句话\"}",
                f"页面数据:{str(page_data)[:1200]}",
                capability="buyer_conversion_semantic",
                schema_keys=["clarity_adjustment"],
            )
            if semantic and isinstance(semantic.get("clarity_adjustment"), (int, float)):
                adj = max(-10, min(10, int(semantic["clarity_adjustment"])))
                old = result["dimension_scores"]["product_clarity"]
                new = max(0, min(100, old + adj))
                result["dimension_scores"]["product_clarity"] = new
                result["overall_score"] = round(
                    sum(result["dimension_scores"].values()) / 5)
                result["ai_source"] = "rule_engine+glm"
                result["semantic_note"] = semantic.get("reason", "")
        except Exception:
            pass  # GLM 不可用时保持纯规则结果

        return SkillResult(output=result, ai_source="template")


register(BuyerConversionSkill())
