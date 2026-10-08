"""SEO / GEO：优化前后 Diff + 草稿生成。"""


def test_seo_diff_has_ten_fields(seed_client):
    res = seed_client.get("/api/seo/diff/prod_002")
    assert res.status_code == 200
    diff = res.json()
    assert diff["productId"] == "prod_002"
    assert diff["productName"] == "Ultrafiltration Unit"
    assert diff["scoreBefore"] == 58
    assert diff["scoreAfter"] > diff["scoreBefore"]
    assert diff["geoAfter"] > diff["geoBefore"]
    assert len(diff["fields"]) == 10
    # 每个字段都要有 before/after，才能渲染"优化前后"
    for f in diff["fields"]:
        assert "label" in f and "before" in f and "after" in f


def test_seo_diff_404(seed_client):
    assert seed_client.get("/api/seo/diff/nope").status_code == 404


def test_seo_optimize_creates_draft(seed_client):
    res = seed_client.post("/api/seo/optimize", json={"productId": "prod_002"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    draft = body["draft"]
    assert draft["entity_type"] == "product"
    assert draft["entity_id"] == "prod_002"
    assert draft["confirmed"] is False
    assert draft["status"] == "draft"
    assert draft["seoScoreAfter"] > draft["seoScoreBefore"]
    assert draft["geoScoreAfter"] > draft["geoScoreBefore"]

    # 草稿出现在草稿列表里
    drafts = seed_client.get("/api/drafts").json()
    assert any(d["id"] == draft["id"] for d in drafts)

    # 关键：生成草稿不应改动线上产品分数
    assert seed_client.get("/api/products/prod_002").json()["seo_score"] == 58


def test_seo_optimize_404(seed_client):
    assert seed_client.post("/api/seo/optimize", json={"productId": "nope"}).status_code == 404
