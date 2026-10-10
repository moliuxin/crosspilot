# -*- coding: utf-8 -*-
"""真能力验收(PHASE 1/5/6/8):SkillRun by-id、公开变体、AI 画笔 Draft→Publish→Rollback 全链。"""
import pytest
from fastapi.testclient import TestClient


def _auth(client, email):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "真链路测试", "industry": "协作机器人",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def _make_site(c, markets=("en-US", "ru-RU")):
    r = c.post("/api/sites/generate", json={
        "company_name": "真链路机器人厂", "product_category": "六轴协作机器人",
        "target_markets": list(markets),
    })
    assert r.status_code == 201, r.text
    return r.json()


def _upgrade(c):
    """购买 growth(演示即时审批)。"""
    o = c.post("/api/service-orders", json={"plan_id": "growth", "feature_key": "brush.edit",
                                            "contact": "", "note": "e2e"}).json()["order"]
    c.post(f"/api/service-orders/{o['id']}/approve")


# ---------------- PHASE 1:skill-runs/{id} ----------------

def test_skill_run_get_by_id(client):
    c = _auth(client, "p3-runid@test.co")
    r = c.post("/api/skills/industry_intelligence/run", json={"input": {"product_category": "协作机器人"}})
    assert r.status_code == 200
    runs = c.get("/api/skills/runs").json()["runs"]
    rid = runs[0]["id"]
    one = c.get(f"/api/skills/runs/{rid}")
    assert one.status_code == 200 and one.json()["id"] == rid
    other = _auth(client, "p3-runid2@test.co")
    assert other.get(f"/api/skills/runs/{rid}").status_code == 404


# ---------------- PHASE 5:公开站返回变体 ----------------

def test_public_site_returns_market_variant(client):
    c = _auth(client, "p3-pub@test.co")
    data = _make_site(c)
    site = data["site"]
    # 未发布 → 404(公开边界)
    slug = site["public_slug"]
    assert client.get(f"/api/public/site?site={slug}").status_code == 404
    # 发布
    c.patch(f"/api/sites/{site['id']}", json={"status": "published"})
    d = client.get(f"/api/public/site?site={slug}&market=ru-RU").json()
    v = d.get("market_variant")
    assert v and v["market"] == "ru-RU"
    assert v["layout_schema"]["sections"]
    assert v["design_tokens"].get("primary")
    seo = v.get("seo_metadata") or {}
    assert seo.get("canonical") == f"/site/{slug}/ru-RU/"
    assert "ru-RU" in seo.get("hreflang", {})
    # 市场间 SEO title 不同
    d2 = client.get(f"/api/public/site?site={slug}&market=en-US").json()
    assert d2["market_variant"]["seo_metadata"]["title"] != seo["title"]


# ---------------- PHASE 6:资产注入区块(真实图片 URL) ----------------

def test_variant_sections_carry_image_urls(client):
    c = _auth(client, "p3-img@test.co")
    data = _make_site(c)
    vs = c.get(f"/api/sites/{data['site']['id']}/market-variants").json()["variants"]
    hero_img = 0
    for v in vs:
        for s in v["layout_schema"]["sections"]:
            if s.get("type") == "hero" and s.get("props", {}).get("image"):
                hero_img += 1
                assert s["props"]["image_source"] in ("REAL", "AI_GENERATED", "FALLBACK")
    assert hero_img >= 1


# ---------------- PHASE 8:AI 画笔全链 ----------------

def test_brush_full_chain(client):
    c = _auth(client, "p3-brush@test.co")
    data = _make_site(c, markets=("ru-RU",))
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    section = v["layout_schema"]["sections"][0]
    assert section["type"] == "hero"

    # 1) 免费账户 → 403
    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": section["id"],
        "instruction": "更适合俄罗斯系统集成商,突出10kg负载、稳定供货和技术支持。"})
    assert r.status_code == 403

    # 2) 购买 + 审批 → entitlement 生效
    _upgrade(c)

    # 3) 生成 → Draft(未确认前变体不变)
    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": section["id"],
        "instruction": "更适合俄罗斯系统集成商,突出10kg负载、稳定供货和技术支持。"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["ai_source"] in ("glm", "template")
    assert d["diff"]
    before_title = section["props"].get("title")

    v_now = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_now = next(s for s in v_now["layout_schema"]["sections"] if s["type"] == "hero")
    assert hero_now["props"].get("title") == before_title  # 未确认,公开变体不变

    # 4) 确认发布 → patch 写入 + Version 落库
    p = c.post("/api/publish", json={"draft_id": d["draft_id"], "human_confirmed": True})
    assert p.status_code == 200, p.text
    version = p.json()["version"]
    assert version["entity_type"] == "market_variant"

    v_pub = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_pub = next(s for s in v_pub["layout_schema"]["sections"] if s["type"] == "hero")
    changed = [x for x in d["diff"] if x["field"] == "title"]
    if changed:
        assert hero_pub["props"]["title"] == changed[0]["after"] != before_title

    # 5) 回滚 → 恢复
    rb = c.post("/api/versions/rollback", json={
        "version_id": version["id"], "entity_type": "market_variant", "entity_id": version["entity_id"]})
    assert rb.status_code == 200, rb.text
    v_back = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_back = next(s for s in v_back["layout_schema"]["sections"] if s["type"] == "hero")
    assert hero_back["props"].get("title") == before_title


def test_brush_tenant_isolated(client):
    a = _auth(client, "p3-iso-a@test.co")
    data = _make_site(a, markets=("en-US",))
    b = _auth(client, "p3-iso-b@test.co")
    _upgrade(b)
    r = b.post("/api/brush/generate", json={
        "site_id": data["site"]["id"], "market": "en-US",
        "section_id": "sec_hero", "instruction": "x"})
    assert r.status_code == 404
