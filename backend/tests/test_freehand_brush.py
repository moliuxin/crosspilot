# -*- coding: utf-8 -*-
"""Freehand AI Brush E2E(全国赛 BATCH1-②,导师规范五)。

手绘圈选 → section_hint 裁决 → Draft(选区元数据落库)→ Diff → 确认发布
→ 公开变体变化 → 回滚。若只有整块点击选中则为 PARTIAL;本文件保证:
- selection 数据结构(selection_mode/polygon_points/bounding_box/section_hint)随 Draft 落库
- section_hint 优先于 section_id(圈了哪块改哪块)
- 无权限仍旧 403;tenant 隔离不受影响
"""
import pytest
from fastapi.testclient import TestClient


def _auth(client, email):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "自由圈选测试", "industry": "协作机器人",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def _make_site(c, markets=("ru-RU",)):
    r = c.post("/api/sites/generate", json={
        "company_name": "圈选机器人厂", "product_category": "10kg Collaborative Robot",
        "target_markets": list(markets),
    })
    assert r.status_code == 201, r.text
    return r.json()


def _upgrade(c):
    o = c.post("/api/service-orders", json={"plan_id": "growth", "feature_key": "brush.edit",
                                            "contact": "", "note": "freehand-e2e"}).json()["order"]
    c.post(f"/api/service-orders/{o['id']}/approve")


# 手绘圈选元数据(模拟前端 FreehandBrushOverlay onConfirm 的产物)
def _lasso_payload(target_hint: str) -> dict:
    return {
        "selection_mode": "freehand",
        "polygon_points": [{"x": 120, "y": 88}, {"x": 360, "y": 92}, {"x": 470, "y": 150},
                           {"x": 452, "y": 236}, {"x": 300, "y": 262}, {"x": 138, "y": 210}],
        "bounding_box": {"x": 120, "y": 88, "w": 350, "h": 174},
        "section_hint": target_hint,
        "strokes": 1,
    }


def test_freehand_selection_adjudicates_target(client, db_session):
    """圈选命中 applications 区块时,即使误传 section_id=hero,也以圈选为准。"""
    c = _auth(client, "fb-target@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    sections = v["layout_schema"]["sections"]
    hero = next(s for s in sections if s["type"] == "hero")
    applications = next((s for s in sections if s["type"] == "applications"), None)
    if applications is None:
        pytest.skip("该布局无 applications 区块")
    _upgrade(c)

    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU",
        "section_id": hero["id"],                     # 点击态残留
        "instruction": "更适合俄罗斯系统集成商,突出 10kg 负载、稳定供货和技术支持。",
        "selection": _lasso_payload(applications["id"]),  # 手绘圈的是 applications
    })
    assert r.status_code == 201, r.text
    d = r.json()
    # 圈选裁决:目标 = 圈选命中的区块,而非残留的 section_id
    assert d["section"]["id"] == applications["id"], d["section"]
    assert d["selection"]["section_hint"] == applications["id"]
    assert d["selection"]["selection_mode"] == "freehand"
    assert len(d["selection"]["polygon_points"]) == 6
    assert d["selection"]["market"] == "ru-RU" and d["selection"]["site_id"] == site_id
    # patch 只写入被圈选的区块
    from app import models
    row = db_session.get(models.Draft, d["draft_id"])
    assert list((row.patch or {}).get("sections", {}).keys()) == [applications["id"]]


def test_freehand_selection_persisted_in_draft(client, db_session):
    """spec 5.3:选区元数据(mode/points/bbox/hint/market/site_id)完整落库。"""
    from app import models

    c = _auth(client, "fb-persist@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    hero = next(s for s in v["layout_schema"]["sections"] if s["type"] == "hero")
    _upgrade(c)

    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": hero["id"],
        "instruction": "突出稳定供货",
        "selection": _lasso_payload(hero["id"]),
    })
    assert r.status_code == 201
    row = db_session.get(models.Draft, r.json()["draft_id"])
    sel = row.selection or {}
    assert sel.get("selection_mode") == "freehand"
    assert sel.get("bounding_box", {}).get("w") == 350
    assert sel.get("section_hint") == hero["id"]
    assert sel.get("market") == "ru-RU" and sel.get("site_id") == site_id


def test_freehand_full_chain_publish_rollback(client):
    """圈选 → Draft → 确认发布(公开变体变化)→ 回滚恢复。"""
    c = _auth(client, "fb-chain@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    hero = next(s for s in v["layout_schema"]["sections"] if s["type"] == "hero")
    before_title = hero["props"].get("title")
    _upgrade(c)

    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": hero["id"],
        "instruction": "更适合俄罗斯系统集成商,突出 10kg 负载、稳定供货和技术支持。",
        "selection": _lasso_payload(hero["id"]),
    })
    assert r.status_code == 201
    draft_id = r.json()["draft_id"]

    # 未确认:公开变体不变
    v_now = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_now = next(s for s in v_now["layout_schema"]["sections"] if s["type"] == "hero")
    assert hero_now["props"].get("title") == before_title

    # 确认发布 → Version
    p = c.post("/api/publish", json={"draft_id": draft_id, "human_confirmed": True})
    assert p.status_code == 200, p.text
    version = p.json()["version"]

    v_pub = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_pub = next(s for s in v_pub["layout_schema"]["sections"] if s["type"] == "hero")
    changed = [x for x in r.json()["diff"] if x["field"] == "title"]
    if changed:
        assert hero_pub["props"]["title"] == changed[0]["after"] != before_title

    # 回滚
    rb = c.post("/api/versions/rollback", json={
        "version_id": version["id"], "entity_type": "market_variant", "entity_id": version["entity_id"]})
    assert rb.status_code == 200
    v_back = c.get(f"/api/sites/{site_id}/market-variants/ru-RU").json()
    hero_back = next(s for s in v_back["layout_schema"]["sections"] if s["type"] == "hero")
    assert hero_back["props"].get("title") == before_title


def test_freehand_still_403_without_entitlement(client):
    c = _auth(client, "fb-403@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    hero = next(s for s in v["layout_schema"]["sections"] if s["type"] == "hero")
    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": hero["id"],
        "instruction": "x", "selection": _lasso_payload(hero["id"])})
    assert r.status_code == 403


def test_freehand_hint_unknown_section_404(client):
    c = _auth(client, "fb-hint404@test.co")
    data = _make_site(c)
    site_id = data["site"]["id"]
    v = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"][0]
    hero = next(s for s in v["layout_schema"]["sections"] if s["type"] == "hero")
    _upgrade(c)
    r = c.post("/api/brush/generate", json={
        "site_id": site_id, "market": "ru-RU", "section_id": hero["id"],
        "instruction": "x", "selection": _lasso_payload("sec_不存在")})
    assert r.status_code == 404
