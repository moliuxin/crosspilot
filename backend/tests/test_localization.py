"""市场本地化端点测试：/api/localization 市场版本与免费额度（服务端裁定）。"""
BASE = "/api/localization"


def test_get_localization_shape(client):
    r = client.get(BASE)
    assert r.status_code == 200
    d = r.json()
    assert d["defaultMarket"] == "en-US"
    assert "en-US" in d["markets"]
    assert d["available"] == ["en-US", "ru-RU", "zh-CN"]
    assert d["freeExtraLimit"] == 1


def test_default_state_has_one_free_extra(client):
    """初始只有 en-US，免费额度应为 1。"""
    d = client.get(BASE).json()
    assert d["markets"] == ["en-US"]
    assert d["freeExtraLeft"] == 1
    assert d["requiresPayment"] is False


def test_generate_first_extra_market_succeeds(client):
    r = client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    assert r.status_code == 200
    d = r.json()
    assert d["already"] is False
    assert "ru-RU" in d["markets"]
    assert d["freeExtraLeft"] == 0
    assert d["requiresPayment"] is True


def test_generate_persists_to_site_state(client):
    """生成后必须真落库到 site/state 的 targetMarkets。"""
    client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    state = client.get("/api/site/state").json()
    assert "ru-RU" in state["targetMarkets"]
    assert client.get(BASE).json()["markets"] == ["en-US", "ru-RU"]


def test_generate_existing_market_is_idempotent(client):
    """重复生成同一市场不报错、不重复计数。"""
    client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    r = client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    assert r.status_code == 200
    assert r.json()["already"] is True
    assert r.json()["markets"] == ["en-US", "ru-RU"]


def test_generate_default_market_already_exists(client):
    """默认市场 en-US 始终存在，请求它应返回 already。"""
    r = client.post(f"{BASE}/generate", json={"market": "en-US"})
    assert r.status_code == 200
    assert r.json()["already"] is True


def test_second_extra_market_returns_402(free_client):
    """免费额度只有 1 个新增市场，第二个必须 402（付费门槛在服务端）。

    用 free_client：套餐含 market.localize 后不该再受免费额度限制，
    所以这条体验额度规则只对 free 套餐生效。
    """
    client = free_client
    client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    r = client.post(f"{BASE}/generate", json={"market": "zh-CN"})
    assert r.status_code == 402
    assert "额度" in str(r.json()["detail"])


def test_402_does_not_mutate_state(free_client):
    """402 被拒后市场列表不能变化。"""
    client = free_client
    client.post(f"{BASE}/generate", json={"market": "ru-RU"})
    before = client.get(BASE).json()["markets"]
    client.post(f"{BASE}/generate", json={"market": "zh-CN"})
    assert client.get(BASE).json()["markets"] == before
    assert "zh-CN" not in client.get("/api/site/state").json()["targetMarkets"]


def test_generate_invalid_market_422(client):
    assert client.post(f"{BASE}/generate", json={"market": "fr-FR"}).status_code == 422


def test_generate_missing_market_422(client):
    assert client.post(f"{BASE}/generate", json={}).status_code == 422


def test_market_order_is_stable(client):
    """返回顺序固定为 en-US → ru-RU → zh-CN，前端 tab 顺序才稳定。"""
    client.post(f"{BASE}/generate", json={"market": "zh-CN"})
    markets = client.get(BASE).json()["markets"]
    assert markets == ["en-US", "zh-CN"]
    assert markets.index("en-US") < markets.index("zh-CN")


def test_existing_ru_market_does_not_block_zh(free_client):
    """若站点本就含 ru-RU，生成 zh-CN 仍应走免费额度判定而非直接拒绝。"""
    client = free_client
    client.put("/api/site/state", json={"targetMarkets": ["en-US", "ru-RU"]})
    d = client.get(BASE).json()
    assert d["freeExtraLeft"] == 0
    assert client.post(f"{BASE}/generate", json={"market": "zh-CN"}).status_code == 402
