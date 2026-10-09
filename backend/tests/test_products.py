"""产品中心：增删改查 + 校验 + AI 生成。"""


def test_list_products(seed_client):
    res = seed_client.get("/api/products")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 4
    ids = {p["id"] for p in data}
    assert "prod_001" in ids


def test_list_products_filter_by_query(seed_client):
    res = seed_client.get("/api/products", params={"q": "ultrafiltration"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert all("ltrafiltration" in p["name"] for p in data)


def test_list_products_filter_by_category(seed_client):
    res = seed_client.get("/api/products", params={"category": "Filtration"})
    assert res.status_code == 200
    data = res.json()
    assert all(p["category"] == "Filtration" for p in data)


def test_get_product_detail(seed_client):
    res = seed_client.get("/api/products/prod_002")
    assert res.status_code == 200
    p = res.json()
    assert p["id"] == "prod_002"
    assert p["seo_score"] == 58
    assert p["geo_score"] == 40


def test_get_product_404(seed_client):
    res = seed_client.get("/api/products/does_not_exist")
    assert res.status_code == 404


def test_create_product_requires_name(seed_client):
    """name 为空时必须 422（Pydantic 校验）。"""
    res = seed_client.post("/api/products", json={"name": "", "model": "X-1"})
    assert res.status_code == 422


def test_create_product_ok(seed_client):
    res = seed_client.post(
        "/api/products",
        json={
            "name": "Sand Filter",
            "model": "AF-SF-100",
            "category": "Filtration",
            "specs": [{"key": "Capacity", "value": "100 m³/h"}],
            "applications": ["Pretreatment"],
        },
    )
    assert res.status_code == 201
    body = res.json()
    product = body["product"]
    assert product["name"] == "Sand Filter"
    assert product["id"]
    # 创建时自动生成内容 + 出现 ai_source
    assert "ai_source" in body
    assert "localized_content" in product
    # 后端 localized_content 按语言短码生成（en/zh/ru）
    assert set(product["localized_content"].keys()) >= {"en"}

    # 落库：再次查询能拿到
    listing = seed_client.get("/api/products").json()
    assert any(p["id"] == product["id"] for p in listing)


def test_update_product(seed_client):
    res = seed_client.put("/api/products/prod_003", json={"name": "Dosing System Pro"})
    assert res.status_code == 200
    assert res.json()["product"]["name"] == "Dosing System Pro"


def test_update_product_404(seed_client):
    res = seed_client.put("/api/products/nope", json={"name": "x"})
    assert res.status_code == 404


def test_delete_product(seed_client):
    res = seed_client.delete("/api/products/prod_003")
    assert res.status_code in (200, 204)
    assert seed_client.get("/api/products/prod_003").status_code == 404


def test_delete_product_404(seed_client):
    res = seed_client.delete("/api/products/nope")
    assert res.status_code == 404
