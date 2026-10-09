"""Agent / 发布 / 站点 / 用量 / 健康检查。

重点覆盖 Agent 安全规则与付费门槛：
- Agent 永不直接改线上，只产草稿
- 发布必须 human_confirmed=true，否则 403
- 免费额度用尽后 consume 返回 402
"""
import pytest


# ---------------- Agent ----------------

def test_agent_seo_query_returns_real_stats(seed_client):
    res = seed_client.post("/api/agent/run", json={"command": "找出 SEO 最差的产品"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["requiresConfirmation"] is False
    assert isinstance(body["table"], list)
    # prod_002 SEO 最低，应排在最前
    assert "Ultrafiltration Unit" in body["table"][0]["a"]


def test_agent_inquiry_query(seed_client):
    res = seed_client.post("/api/agent/run", json={"command": "统计一下询盘"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert "询盘" in body["summary"]


def test_agent_diagnose(seed_client):
    res = seed_client.post("/api/agent/run", json={"command": "给网站做个 SEO 诊断"})
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_agent_localization_creates_draft(seed_client):
    res = seed_client.post("/api/agent/run", json={"command": "生成俄语市场落地页"})
    assert res.status_code == 200
    body = res.json()
    assert body["requiresConfirmation"] is True
    assert body["draft"]["entity_type"] == "page"
    assert body["draft"]["market"] == "ru-RU"


def test_agent_default_creates_draft_for_worst_product(seed_client):
    res = seed_client.post("/api/agent/run", json={"command": "帮我处理一下站点内容"})
    assert res.status_code == 200
    body = res.json()
    assert body["requiresConfirmation"] is True
    assert body["draft"]["entity_id"] == "prod_002"
    # 生成草稿不能改线上
    assert seed_client.get("/api/products/prod_002").json()["seo_score"] == 58


def test_agent_structured_patch(seed_client):
    res = seed_client.post(
        "/api/agent/run",
        json={
            "entity_type": "product",
            "entity_id": "prod_002",
            "patch": {"title": "New Title", "slug": "/uf-unit/"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["requiresConfirmation"] is True
    fields = {d["field"] for d in body["draft"]["diff"]}
    assert {"title", "slug"} <= fields


# ---------------- 发布（人工确认硬约束） ----------------

def test_publish_requires_human_confirmation(seed_client):
    """human_confirmed=false 必须 403 —— Agent 不能自己发布。"""
    draft = seed_client.post("/api/seo/optimize", json={"productId": "prod_002"}).json()["draft"]
    res = seed_client.post("/api/publish", json={"draft_id": draft["id"], "human_confirmed": False})
    assert res.status_code == 403


def test_publish_applies_scores_and_updates_site(seed_client):
    draft = seed_client.post("/api/seo/optimize", json={"productId": "prod_002"}).json()["draft"]
    res = seed_client.post("/api/publish", json={"draft_id": draft["id"], "human_confirmed": True})
    assert res.status_code == 200
    assert res.json()["published"] is True

    # 分数真正落库（58 → 83）
    p = seed_client.get("/api/products/prod_002").json()
    assert p["seo_score"] == draft["seoScoreAfter"]
    assert p["seo_score"] > 58

    # 站点状态变为已发布
    site = seed_client.get("/api/site/state").json()
    assert site["publishStatus"] == "published"


def test_publish_twice_conflicts(seed_client):
    draft = seed_client.post("/api/seo/optimize", json={"productId": "prod_002"}).json()["draft"]
    seed_client.post("/api/publish", json={"draft_id": draft["id"], "human_confirmed": True})
    again = seed_client.post("/api/publish", json={"draft_id": draft["id"], "human_confirmed": True})
    assert again.status_code == 409


def test_publish_unknown_draft_404(seed_client):
    res = seed_client.post("/api/publish", json={"draft_id": "nope", "human_confirmed": True})
    assert res.status_code == 404


# ---------------- 站点 / 用量 ----------------

def test_site_state_roundtrip(seed_client):
    res = seed_client.put("/api/site/state", json={"companyName": "NewCo", "plan": "growth"})
    assert res.status_code == 200
    assert res.json()["site"]["companyName"] == "NewCo"
    assert seed_client.get("/api/site/state").json()["plan"] == "growth"


def test_site_generate_records_company(seed_client):
    res = seed_client.post(
        "/api/site/generate",
        json={"company": "Aqua New", "industry": "水处理", "markets": ["en-US", "ru-RU"]},
    )
    assert res.status_code == 200
    site = seed_client.get("/api/site/state").json()
    assert site["companyName"] == "Aqua New"
    assert "ru-RU" in site["targetMarkets"]


def test_usage_starts_at_one_free(seed_client):
    usage = seed_client.get("/api/usage").json()
    assert usage["freeGenerationLimit"] == 1
    assert usage["freeGenerationUsed"] == 0


def test_usage_consume_then_402(seed_client):
    first = seed_client.post("/api/usage/consume")
    assert first.status_code == 200
    assert first.json()["freeGenerationUsed"] == 1
    # 第二次超限 → 402（付费墙）
    second = seed_client.post("/api/usage/consume")
    assert second.status_code == 402


# ---------------- 健康检查 ----------------

def test_health_reports_db_and_ai(seed_client):
    res = seed_client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["database"] == "up"
    assert body["products"] >= 4
    assert "ai" in body and "provider" in body["ai"]


def test_metrics_from_real_data(seed_client):
    res = seed_client.get("/api/metrics")
    assert res.status_code == 200
    body = res.json()
    assert body["inquiries"]["value"] == "5"
    for key in ("visits30d", "inquiries", "organicClicks", "aiCitations"):
        assert key in body


def test_site_health_dynamic(seed_client):
    res = seed_client.get("/api/health/site")
    assert res.status_code == 200
    body = res.json()
    assert 0 <= body["score"] <= 100
    assert body["opportunities"] >= 0
    assert len(body["items"]) >= 4
    for item in body["items"]:
        assert item["level"] in ("good", "warn", "bad")


# ---------------- 企业认证 ----------------

def test_company_get(seed_client):
    res = seed_client.get("/api/company")
    assert res.status_code == 200


def test_company_verify_accepts_valid_code(seed_client):
    res = seed_client.post("/api/company/verify", json={"company": "AQUAFLOW Industrial", "code": "1234"})
    assert res.status_code == 200
    assert res.json()["verified"] is True


def test_company_verify_rejects_short_code(seed_client):
    res = seed_client.post("/api/company/verify", json={"company": "AQUAFLOW Industrial", "code": "12"})
    assert res.status_code == 200
    assert res.json()["verified"] is False
