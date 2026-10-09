"""P0-2 / P0-4：SEO 发布必须真实修改内容字段 + 版本快照与真回滚。

验收标准（来自外部审计）：
- 发布后重新 GET 产品，title/slug/meta/h1/faq/alt/schema 必须真的变化
- 不能只让评分上涨
- 回滚后重新 GET，数据必须恢复旧版本
"""
import pytest

BASE = "/api"
PID = "prod_002"  # 种子中 SEO 最差的产品（58/40，title 为占位）


def _get_product(seed_client):
    return seed_client.get(f"{BASE}/products/{PID}").json()


def _make_and_publish(seed_client):
    r = seed_client.post(f"{BASE}/seo/optimize", json={"productId": PID})
    assert r.status_code == 200
    draft_id = r.json()["draft"]["id"]
    pub = seed_client.post(f"{BASE}/publish", json={"draft_id": draft_id, "human_confirmed": True})
    assert pub.status_code == 200
    return pub.json()


def test_seo_publish_writes_content_not_just_scores(seed_client):
    """发布后内容字段必须真实变化 —— 这是「真优化」与「假优化」的分界线。"""
    before = _get_product(seed_client)
    b_seo = before["seo"]

    _make_and_publish(seed_client)

    after = _get_product(seed_client)
    a_seo = after["seo"]

    # 内容字段逐项对比
    assert a_seo["title"] != b_seo["title"], "title 未变化"
    assert a_seo["slug"] != b_seo["slug"], "slug 未变化"
    assert a_seo["slug"].startswith("/") and a_seo["slug"].endswith("/")
    assert a_seo["meta_description"] != b_seo.get("meta_description"), "meta 未变化"
    assert a_seo["h1"] != b_seo.get("h1"), "h1 未变化"
    assert len(a_seo["faq"]) >= 8, "FAQ 未真实写入"
    assert all("q" in f and "a" in f for f in a_seo["faq"]), "FAQ 必须是结构化 q/a"
    assert len(a_seo["image_alt"]) >= 8, "ALT 未真实写入"
    assert a_seo["schema_enabled"] is True, "Product Schema 未启用"
    assert a_seo.get("faq_schema_enabled") is True, "FAQ Schema 未启用"

    # 分数同步变化
    assert after["seo_score"] > before["seo_score"]
    assert after["geo_score"] > before["geo_score"]


def test_publish_creates_version_snapshot(seed_client):
    """发布必须落版本快照（before/after），否则回滚无从谈起。"""
    res = _make_and_publish(seed_client)
    ver = res["version"]
    assert ver["entity_type"] == "product"
    assert ver["entity_id"] == PID
    assert ver["version_no"] >= 1

    detail = seed_client.get(f"{BASE}/versions/{ver['id']}").json()
    assert detail["before_snapshot"]["seo"]["title"] != detail["after_snapshot"]["seo"]["title"]
    assert detail["action"] == "publish"

    history = seed_client.get(f"{BASE}/versions", params={"entity_type": "product", "entity_id": PID}).json()
    assert any(v["id"] == ver["id"] for v in history)


def test_rollback_restores_previous_content(seed_client):
    """真回滚：GET 恢复旧内容，而不是一句 toast。"""
    before = _get_product(seed_client)
    res = _make_and_publish(seed_client)

    mid = _get_product(seed_client)
    assert mid["seo"]["title"] != before["seo"]["title"]

    rb = seed_client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "product", "entity_id": PID, "version_id": res["version"]["id"]},
    )
    assert rb.status_code == 200
    assert rb.json()["rolled_back"] is True

    restored = _get_product(seed_client)
    assert restored["seo"]["title"] == before["seo"]["title"]
    assert restored["seo"]["slug"] == before["seo"]["slug"]
    assert restored["seo"]["faq"] == before["seo"]["faq"]
    assert restored["seo_score"] == before["seo_score"]
    assert restored["geo_score"] == before["geo_score"]

    # 回滚本身也是一条版本记录（action=rollback）
    history = seed_client.get(f"{BASE}/versions", params={"entity_type": "product", "entity_id": PID}).json()
    assert history[0]["action"] == "rollback"


def test_rollback_missing_version_404(seed_client):
    r = seed_client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "product", "entity_id": PID, "version_id": "ver_not_exist"},
    )
    assert r.status_code == 404


def test_create_draft_rejects_noop_patch(seed_client):
    """patch 与现状一致时应 409，避免发布无意义的空版本。"""
    p = _get_product(seed_client)
    r = seed_client.post(
        f"{BASE}/drafts",
        json={"entity_type": "product", "entity_id": PID, "patch": {"description": p["description"]}},
    )
    assert r.status_code == 409


def test_create_draft_then_publish_applies_patch(seed_client):
    """MCP update_draft → publish 链路：patch 必须真实落库。"""
    new_desc = "Custom patched description for verification."
    d = seed_client.post(
        f"{BASE}/drafts",
        json={"entity_type": "product", "entity_id": PID, "patch": {"description": new_desc}, "title": "改描述"},
    )
    assert d.status_code == 201
    draft = d.json()["draft"]
    assert any(x["field"] == "description" for x in draft["diff"]), "diff 应反映真实变化"

    pub = seed_client.post(f"{BASE}/publish", json={"draft_id": draft["id"], "human_confirmed": True})
    assert pub.status_code == 200

    assert _get_product(seed_client)["description"] == new_desc


def test_publish_unconfirmed_still_403(seed_client):
    r = seed_client.post(f"{BASE}/seo/optimize", json={"productId": PID})
    draft_id = r.json()["draft"]["id"]
    r2 = seed_client.post(f"{BASE}/publish", json={"draft_id": draft_id, "human_confirmed": False})
    assert r2.status_code == 403
