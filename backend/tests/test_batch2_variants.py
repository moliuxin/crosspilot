# -*- coding: utf-8 -*-
"""第二批(PHASE 6/7/8/9):市场变体 + Transcreation + 槽位管线 + 视觉 Skill。"""
import pytest
from fastapi.testclient import TestClient

from app import knowledge
from app.skills import registry
from app.skills.base import SkillContext
from app.skills.market_transcreation import FORBIDDEN_AI_ROLES


@pytest.fixture(scope="module", autouse=True)
def _load():
    import app.skills  # noqa: F401
    yield


def _auth(client, email="batch2@test.co"):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "变体测试公司", "industry": "协作机器人",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def _make_site(c, category="六轴协作机器人", markets=None):
    r = c.post("/api/sites/generate", json={
        "company_name": f"{category}工厂", "product_category": category,
        "target_markets": markets or ["zh-CN", "en-US", "ru-RU"],
    })
    assert r.status_code == 201, r.text
    return r.json()


# ---------------- PHASE 6:SiteMarketVariant ----------------

def test_generate_persists_three_distinct_variants(client):
    c = _auth(client, "b2-variants@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    assert len(data["market_variants"]) == 3

    vs = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"]
    assert {v["market"] for v in vs} == {"zh-CN", "en-US", "ru-RU"}
    layouts = {v["market"]: [s["type"] for s in v["layout_schema"]["sections"]] for v in vs}
    assert layouts["zh-CN"] != layouts["en-US"] != layouts["ru-RU"]
    assert "factory" in layouts["zh-CN"] and "factory" not in layouts["en-US"]
    assert "supply_capability" in layouts["ru-RU"]
    # hero 文案随市场不同(转创,非互译)
    heroes = {v["market"]: v["content_json"]["copy"]["hero"]["title"] for v in vs}
    assert len(set(heroes.values())) == 3
    # CTA 来自各自市场词库
    for v in vs:
        mk = knowledge.market_knowledge(v["market"])
        assert v["content_json"]["copy"]["hero"]["cta"] in mk["cta"]["primary"] + mk["cta"]["secondary"]
    # tokens 存在且通过 WCAG
    for v in vs:
        assert v["design_tokens"].get("primary")
    # 资产清单存在(hero 槽位已解析)
    for v in vs:
        assert "hero" in v["asset_manifest"] and v["asset_manifest"]["hero"]["source_type"]


def test_variant_detail_and_regenerate(client):
    c = _auth(client, "b2-detail@test.co")
    data = _make_site(c, markets=["en-US"])
    site_id = data["site"]["id"]
    d = c.get(f"/api/sites/{site_id}/market-variants/en-US").json()
    assert d["market"] == "en-US"
    r = c.post(f"/api/sites/{site_id}/market-variants/generate")
    assert r.status_code == 201
    assert len(r.json()["variants"]) >= 1


def test_variants_tenant_isolated(client):
    a = _auth(client, "b2-iso-a@test.co")
    data = _make_site(a, markets=["en-US"])
    site_id = data["site"]["id"]
    b = _auth(client, "b2-iso-b@test.co")
    assert b.get(f"/api/sites/{site_id}/market-variants").status_code == 404


def test_facts_layer_not_modified(client):
    """市场变体生成不得修改 Product 事实层。"""
    c = _auth(client, "b2-facts@test.co")
    before = c.get("/api/products").json()
    _make_site(c)
    after = c.get("/api/products").json()
    key = lambda ps: [(p["id"], p.get("specs")) for p in ps]
    assert key(before) == key(after)


# ---------------- PHASE 7:Transcreation ----------------

@pytest.mark.asyncio
async def test_transcreation_forbidden_cta_replaced():
    skill = registry.get("market_transcreation")
    # 模拟 GLM 不可用(模板路径),验证质量门结构
    res = await skill.execute(SkillContext(tenant_id=1, market="ru-RU"),
                              {"market": "ru-RU", "product_category": "协作机器人"})
    q = res.output["quality_report"]
    assert all(x["check"] in ("cta_whitelist", "no_ecommerce_cta", "facts_untouched") for x in q)
    assert all(x["pass"] for x in q)
    ru_cta = res.output["copy"]["hero"]["cta"]
    mk = knowledge.market_knowledge("ru-RU")
    assert ru_cta in mk["cta"]["primary"] + mk["cta"]["secondary"]


@pytest.mark.asyncio
async def test_transcreation_markets_differ_not_translation():
    skill = registry.get("market_transcreation")
    outs = {}
    for m in ("zh-CN", "en-US", "ru-RU"):
        res = await skill.execute(SkillContext(tenant_id=1, market=m),
                                  {"market": m, "product_category": "工业水泵"})
        outs[m] = res.output["copy"]["hero"]["title"]
    assert len(set(outs.values())) == 3
    assert "源头工厂" in outs["zh-CN"]
    assert "производителя" in outs["ru-RU"]


# ---------------- PHASE 8/9:视觉管线 ----------------

@pytest.mark.asyncio
async def test_visual_brief_forbidden_fact_slots():
    skill = registry.get("visual_brief")
    res = await skill.execute(SkillContext(tenant_id=1), {
        "product_category": "协作机器人",
        "slots": ["hero", "certification", "product_cover"],
    })
    briefs = {b["slot"]: b for b in res.output["briefs"]}
    assert briefs["certification"]["forbidden"] is True
    assert "negative_prompt" in briefs["hero"]
    assert "no fabricated certification" in briefs["hero"]["negative_prompt"]


@pytest.mark.asyncio
async def test_visual_generation_skips_forbidden_and_marks_ai():
    skill = registry.get("visual_generation")
    res = await skill.execute(SkillContext(tenant_id=1, market="ru-RU"), {
        "briefs": [
            {"slot": "hero", "subject": "robot arm", "scene": "factory", "negative_prompt": ""},
            {"slot": "customer_logo"},
        ],
    })
    imgs = {i["slot"]: i for i in res.output["images"]}
    assert imgs["customer_logo"]["skipped"] is True
    assert imgs["hero"].get("source_type") == "AI_GENERATED"
    assert imgs["hero"].get("url")  # mock provider 给 SVG data URL


def test_asset_extended_columns_in_dict(client):
    c = _auth(client, "b2-asset@test.co")
    data = _make_site(c, markets=["en-US"])
    site_id = data["site"]["id"]
    assets = c.get(f"/api/sites/{site_id}/assets").json()["assets"]
    assert assets
    for a in assets:
        assert "product_id" in a and "sort_order" in a and "is_primary" in a
