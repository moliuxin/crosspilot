"""产品批量导入端点测试：/api/products/bulk-import。"""
BASE = "/api/products"

VALID_ITEMS = [
    {"name": "便携式储能电源", "model": "AF-PS600", "category": "储能", "specs": ["容量: 600Wh", "输出: 600W"], "applications": ["露营"]},
    {"name": "太阳能折叠板", "model": "AF-SP120", "category": "光伏", "specs": ["功率: 120W"], "applications": ["户外充电"]},
]


def test_bulk_import_creates_all_rows(client):
    r = client.post(f"{BASE}/bulk-import", json={"items": VALID_ITEMS})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["created_count"] == 2
    assert data["failed_count"] == 0
    assert [c["index"] for c in data["created"]] == [1, 2]


def test_bulk_import_rows_are_queryable(client):
    client.post(f"{BASE}/bulk-import", json={"items": VALID_ITEMS})
    products = client.get(BASE).json()
    names = [p["name"] for p in products]
    assert "便携式储能电源" in names
    assert "太阳能折叠板" in names


def test_bulk_import_parses_specs_into_pairs(client):
    """'Key: Value' 形式的参数应被解析成 {key, value} 结构。"""
    client.post(f"{BASE}/bulk-import", json={"items": [VALID_ITEMS[0]]})
    product = next(p for p in client.get(BASE).json() if p["name"] == VALID_ITEMS[0]["name"])
    specs = {s["key"]: s["value"] for s in product["specs"]}
    assert specs["容量"] == "600Wh"
    assert specs["输出"] == "600W"


def test_bulk_import_spec_without_colon_kept(client):
    """没有冒号的参数不丢弃，作为 key 保留。"""
    client.post(f"{BASE}/bulk-import", json={"items": [{"name": "无冒号参数产品", "specs": ["IP66 防水"]}]})
    product = next(p for p in client.get(BASE).json() if p["name"] == "无冒号参数产品")
    assert product["specs"][0]["key"] == "IP66 防水"


def test_bulk_import_sets_default_category(client):
    client.post(f"{BASE}/bulk-import", json={"items": [{"name": "无分类产品"}]})
    product = next(p for p in client.get(BASE).json() if p["name"] == "无分类产品")
    assert product["category"] == "General"


def test_bulk_import_generates_seo_baseline(client):
    """批量导入的产品应带 SEO 基线分数与 URL slug，而非空对象。"""
    client.post(f"{BASE}/bulk-import", json={"items": [VALID_ITEMS[1]]})
    product = next(p for p in client.get(BASE).json() if p["name"] == VALID_ITEMS[1]["name"])
    assert product["seo_score"] == 60
    assert product["seo"]["title"]
    assert product["seo"]["slug"].startswith("/")


def test_bulk_import_empty_items_422(client):
    assert client.post(f"{BASE}/bulk-import", json={"items": []}).status_code == 422


def test_bulk_import_item_missing_name_422(client):
    assert client.post(f"{BASE}/bulk-import", json={"items": [{"model": "AF-X"}]}).status_code == 422


def test_bulk_import_over_200_items_422(client):
    """上限 200 条，防止一次请求打爆数据库。"""
    items = [{"name": f"产品{i}"} for i in range(201)]
    assert client.post(f"{BASE}/bulk-import", json={"items": items}).status_code == 422


def test_bulk_import_exactly_200_items_ok(client):
    items = [{"name": f"批量产品{i}"} for i in range(200)]
    r = client.post(f"{BASE}/bulk-import", json={"items": items})
    assert r.status_code == 200
    assert r.json()["created_count"] == 200


def test_bulk_import_single_item_returns_counts(client):
    r = client.post(f"{BASE}/bulk-import", json={"items": [VALID_ITEMS[0]]})
    data = r.json()
    assert data["created_count"] == 1
    assert data["failed_count"] == 0
    assert len(data["created"]) == 1
