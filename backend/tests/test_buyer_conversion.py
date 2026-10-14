# -*- coding: utf-8 -*-
"""Buyer Conversion Readiness 真实算法验收(P0-8 规范六)。

6.2 规则引擎集中在 buyer_conversion.py(确定性,同输入同输出);
6.4 BuyerConversionReport 落库;6.5 闭环 Analyze→Report→Improvement→Draft
→Diff→Confirm→Publish→Re-score;6.6 单调性:
  - 增加 MOQ → procurement_information 不得下降
  - 增加明确 RFQ CTA → cta_clarity 不得下降
  - 删除 Certification → trust_evidence 不得提高
前端无硬编码分数;Readiness Score ≠ 成交概率(如实标注)。
"""
import pytest
from fastapi.testclient import TestClient

from app.skills.buyer_conversion import score_all


# ---------------- 6.6 规则层单调性 ----------------

_BASE = {
    "name": "10kg Collaborative Robot", "model": "CR-10", "specs": ["负载10kg", "repeat ±0.02mm"],
    "applications": ["焊接", "装配"], "description": "六轴协作机器人",
    "certifications": ["CE", "ISO9001"], "cases": ["case-a"], "company_name": "XJU Robotics",
    "factory_info": "两大生产基地", "warranty": "36个月",
    "cta_in_lexicon": True, "cta_no_ecommerce": True, "secondary_cta": "Talk to an Engineer",
    "rfq_form": True, "contact_email": "sales@x.co", "response_time": "12h",
    "multiple_channels": True, "form_fields_min": True,
}


def test_monotonic_add_moq():
    before = score_all(_BASE)["dimension_scores"]["procurement_information"]
    after = score_all({**_BASE, "moq": "1 set"})["dimension_scores"]["procurement_information"]
    assert after > before
    assert after >= before  # 平凡真值,语义自文档化


def test_monotonic_add_rfq_cta():
    no_cta = {**_BASE, "cta_in_lexicon": False, "cta_no_ecommerce": True}
    s0 = score_all(no_cta)["dimension_scores"]["cta_clarity"]
    s1 = score_all({**no_cta, "cta_in_lexicon": True})["dimension_scores"]["cta_clarity"]
    assert s1 > s0


def test_monotonic_remove_certification():
    with_cert = score_all(_BASE)["dimension_scores"]["trust_evidence"]
    without = score_all({**_BASE, "certifications": []})["dimension_scores"]["trust_evidence"]
    assert without < with_cert


def test_deterministic_same_input_same_output():
    assert score_all(_BASE) == score_all(_BASE)


def test_score_not_perfect_when_empty():
    r = score_all({})
    assert r["overall_score"] == 0 and r["missing_information"]


# ---------------- 6.4/6.5 API 闭环 ----------------

def _auth(client, email):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "转化测试公司", "industry": "协作机器人",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def _make_site(c, markets=("ru-RU",)):
    r = c.post("/api/sites/generate", json={
        "company_name": "转化机器人厂", "product_category": "10kg Collaborative Robot",
        "target_markets": list(markets),
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_analyze_persists_report(client, db_session):
    from app import models
    c = _auth(client, "bc-analyze@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    r = c.post(f"/api/sites/{site_id}/conversion/analyze", json={"market": "ru-RU", "use_semantic": False})
    assert r.status_code == 201, r.text
    rep = r.json()["report"]
    assert set(rep["dimension_scores"]) == {"product_clarity", "trust_evidence",
                                            "procurement_information", "cta_clarity", "rfq_convenience"}
    assert rep["provider"] == "rule_engine" and rep["rule_version"]
    assert rep["note"].startswith("Readiness Score") or "Readiness" in rep.get("note", "")
    # 落库可查
    row = db_session.get(models.BuyerConversionReport, rep["id"])
    assert row is not None and row.site_id == site_id
    # 历史
    h = c.get(f"/api/sites/{site_id}/conversion/reports?market=ru-RU").json()
    assert any(x["id"] == rep["id"] for x in h["reports"])


def test_improvement_loop_real_facts_only(client, db_session):
    """闭环:无事实 422 拒绝 → 补充真实采购信息 → 改进草稿 → 发布 → Re-score 采购维度上升。"""
    c = _auth(client, "bc-loop@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]

    # 首次分析(基线)
    r0 = c.post(f"/api/sites/{site_id}/conversion/analyze", json={"market": "ru-RU", "use_semantic": False}).json()
    base_proc = r0["report"]["dimension_scores"]["procurement_information"]

    # 无采购事实 → 422 拒绝编造
    imp0 = c.post(f"/api/sites/{site_id}/conversion/improvement-draft", json={"market": "ru-RU"})
    assert imp0.status_code == 422, imp0.text

    # 商家补充真实采购信息(产品 specs:SpecItem {key,value})
    pr = c.post("/api/products", json={
        "name": "CR-10 协作机器人", "model": "CR-10", "category": "协作机器人",
        "specs": [
            {"key": "MOQ", "value": "1 set"},
            {"key": "Lead time", "value": "15 days"},
            {"key": "Warranty", "value": "36 months"},
            {"key": "Payment", "value": "T/T, LC at sight"},
            {"key": "Shipping", "value": "FOB Ningbo"},
            {"key": "Payload", "value": "10 kg"},
        ],
        "description": "六轴协作机器人",
    })
    assert pr.status_code in (200, 201), pr.text

    # 改进草稿(自动基于最新报告)
    imp = c.post(f"/api/sites/{site_id}/conversion/improvement-draft", json={"market": "ru-RU"})
    assert imp.status_code == 201, imp.text
    draft_id = imp.json()["draft_id"]
    assert imp.json()["diff"]

    # 未确认前公开变体不变
    v = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    rfq = next(s for s in v["layout_schema"]["sections"] if s["type"] == "rfq")
    assert not (rfq["props"] or {}).get("procurement_moq")

    # 确认发布
    p = c.post("/api/publish", json={"draft_id": draft_id, "human_confirmed": True})
    assert p.status_code == 200, p.text

    # Re-score:procurement_information 不得下降(实测上升)
    r1 = c.post(f"/api/sites/{site_id}/conversion/analyze", json={"market": "ru-RU", "use_semantic": False}).json()
    after_proc = r1["report"]["dimension_scores"]["procurement_information"]
    assert after_proc > base_proc, (base_proc, after_proc)
    v2 = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    rfq2 = next(s for s in v2["layout_schema"]["sections"] if s["type"] == "rfq")
    assert rfq2["props"].get("procurement_moq")  # 公开变体真实带上了采购信息


def test_conversion_tenant_isolated(client):
    a = _auth(client, "bc-iso-a@test.co")
    data = _make_site(a)
    b = _auth(client, "bc-iso-b@test.co")
    r = b.post(f"/api/sites/{data['site']['id']}/conversion/analyze", json={"market": "ru-RU"})
    assert r.status_code == 404
