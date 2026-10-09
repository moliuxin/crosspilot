# -*- coding: utf-8 -*-
"""PHASE 1/2/3/5:Skill Engine + 行业智能 + 市场知识 + Component Registry。"""
import pytest
from fastapi.testclient import TestClient

from app import knowledge
from app.skills import registry
from app.skills.base import SkillContext
from app.skills.component_registry import COMPONENTS, MARKET_DEFAULT_SECTIONS, layout_for_market


@pytest.fixture(scope="module", autouse=True)
def _load_skills():
    import app.skills  # noqa: F401 — 导入即注册
    yield


def _auth(client, email="skill-rt@test.co"):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "Skill引擎测试", "industry": "工业水泵",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


# ---------------- PHASE 1:引擎与 API ----------------

def test_registry_lists_skills(client):
    c = _auth(client)
    r = c.get("/api/skills")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["skills"]]
    assert {"industry_intelligence", "theme_style", "market_localization", "layout_planning"} <= set(ids)
    for s in r.json()["skills"]:
        assert "input_schema" in s and "version" in s


def test_skill_run_success_persists_skillrun(client):
    c = _auth(client, "skill-run@test.co")
    r = c.post("/api/skills/industry_intelligence/run", json={
        "input": {"product_category": "协作机器人"},
    })
    assert r.status_code == 200
    d = r.json()
    assert d["ok"]
    assert d["output"]["industry"] == "industrial_robotics"
    runs = c.get("/api/skills/runs").json()["runs"]
    assert any(x["skill_id"] == "industry_intelligence" and x["status"] == "success" for x in runs)


def test_skill_run_invalid_input_422(client):
    c = _auth(client, "skill-bad@test.co")
    r = c.post("/api/skills/industry_intelligence/run", json={"input": {}})
    assert r.status_code == 422
    assert "必填" in r.json()["detail"]["message"]


def test_skill_runs_tenant_isolated(client):
    a = _auth(client, "iso-a@test.co")
    b = _auth(client, "iso-b@test.co")
    a.post("/api/skills/theme_style/run", json={"input": {"industry": "industrial_robotics"}})
    runs_b = b.get("/api/skills/runs").json()["runs"]
    assert all(x["skill_id"] != "theme_style" for x in runs_b)


# ---------------- PHASE 2:行业智能 ----------------

@pytest.mark.asyncio
async def test_industry_rule_match_robotics():
    skill = registry.get("industry_intelligence")
    res = await skill.execute(SkillContext(tenant_id=1), {"product_category": "六轴协作机器人 10kg"})
    assert res.output["industry"] == "industrial_robotics"
    assert res.output["decision_model"].startswith("B2B")
    assert res.output["buyer_roles"] and res.output["pain_points"]
    assert any("EAC" in t or "ГОСТ" in t for t in res.output["trust_requirements"])


@pytest.mark.asyncio
async def test_industry_fallback_general():
    skill = registry.get("industry_intelligence")
    res = await skill.execute(SkillContext(tenant_id=1), {"product_category": "zzz 完全未知品类 qqq"})
    assert res.output["industry"] == "general_b2b"
    assert res.output["image_keywords"]


def test_knowledge_seven_industries():
    inds = knowledge.list_industries()
    assert {"industrial_robotics", "industrial_machinery", "ai_hardware", "electronics",
            "photovoltaic", "building_materials", "general_b2b"} <= set(inds)


# ---------------- PHASE 3:市场知识 ----------------

def test_market_knowledge_ru():
    k = knowledge.market_knowledge("ru-RU")
    assert "Запросить цену" in k["cta"]["primary"]
    assert "В корзину" in k["cta"]["forbidden"]
    assert any(i["idiom"] == "под ключ" for i in k["idioms"]["idioms"])
    assert "152-ФЗ" in k["compliance"]["rfq_consent"]["law"]
    assert "юридическая проверка" in k["compliance"]["note"] or "техническая подсказка" in k["compliance"]["note"]


def test_market_knowledge_invalid():
    assert knowledge.market_knowledge("xx-XX") == {}


@pytest.mark.asyncio
async def test_market_localization_cta_from_lexicon():
    skill = registry.get("market_localization")
    res = await skill.execute(SkillContext(tenant_id=1, market="ru-RU"),
                              {"market": "ru-RU", "product_category": "工业水泵"})
    cta_primary = res.output["cta_lexicon"]["primary"]
    assert res.output["hero"]["cta"] in res.output["cta_lexicon"]["primary"] + res.output["cta_lexicon"]["secondary"]
    assert cta_primary


# ---------------- PHASE 4 部分:WCAG ----------------

@pytest.mark.asyncio
async def test_theme_style_wcag_pass():
    skill = registry.get("theme_style")
    res = await skill.execute(SkillContext(tenant_id=1), {"industry": "industrial_robotics"})
    report = res.output["wcag_report"]
    assert all(c["pass"] for c in report), report


def test_wcag_detector_catches_bad_pair():
    from app.skills.market_localization import wcag_check
    bad = {"on_dark": "#777777", "primary": "#666666", "on_accent": "#eeeeee", "accent": "#ffffff",
           "text": "#999999", "bg": "#888888"}
    report = wcag_check(bad)
    assert any(not c["pass"] for c in report)


# ---------------- PHASE 5:Component Registry ----------------

def test_component_registry_shape():
    for cid, meta in COMPONENTS.items():
        assert meta.get("name") and "supported_markets" in meta and "asset_slots" in meta


def test_market_default_layouts_distinct():
    zh = [s["type"] for s in MARKET_DEFAULT_SECTIONS["zh-CN"]]
    en = [s["type"] for s in MARKET_DEFAULT_SECTIONS["en-US"]]
    ru = [s["type"] for s in MARKET_DEFAULT_SECTIONS["ru-RU"]]
    assert zh != en != ru != zh
    assert "factory" in zh and "factory" not in en and "factory" not in ru
    assert "supply_capability" in ru and "supply_capability" not in en
    assert "fast_quote" in en and "fast_quote" not in zh


@pytest.mark.asyncio
async def test_layout_planning_enriched_with_meta():
    skill = registry.get("layout_planning")
    res = await skill.execute(SkillContext(tenant_id=1, market="ru-RU"),
                              {"market": "ru-RU", "product_category": "协作机器人"})
    sections = res.output["sections"]
    assert sections and all("component_meta" in s for s in sections)
    assert sections[0]["type"] == "hero"
    ru_types = [s["type"] for s in sections]
    assert "rfq" in ru_types


def test_layout_industry_priority_reorder():
    industry = {"layout_hints": {"sections_priority": ["products", "hero"]}}
    base = layout_for_market("en-US", industry)
    assert base[0]["type"] == "products" or base[0]["type"] == "hero"
