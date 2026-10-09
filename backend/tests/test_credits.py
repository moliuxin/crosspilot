"""额度端点测试：/api/credits 消耗、充值、402 门槛与流水。"""
BASE = "/api/credits"


def test_get_credits_shape(client):
    r = client.get(BASE)
    assert r.status_code == 200
    c = r.json()
    assert c["balance"] > 0
    assert c["totalGranted"] > 0
    assert c["used"] == c["totalGranted"] - c["balance"]


def test_consume_reduces_balance_and_writes_log(client):
    before = client.get(BASE).json()["balance"]

    r = client.post(f"{BASE}/consume", json={"skill": "AI 文案生成", "cost": 120, "note": "生成 3 个产品文案"})
    assert r.status_code == 200
    assert r.json()["credits"]["balance"] == before - 120

    logs = client.get(f"{BASE}/logs").json()
    assert logs[0]["skill"] == "AI 文案生成"
    assert logs[0]["cost"] == 120
    assert logs[0]["balance_after"] == before - 120


def test_consume_zero_cost_allowed(client):
    r = client.post(f"{BASE}/consume", json={"skill": "免费能力", "cost": 0})
    assert r.status_code == 200


def test_consume_insufficient_returns_402(client):
    """余额不足必须返回 402（付费门槛），而不是 400/500。"""
    balance = client.get(BASE).json()["balance"]
    r = client.post(f"{BASE}/consume", json={"skill": "超贵能力", "cost": balance + 1})
    assert r.status_code == 402
    assert "不足" in r.json()["detail"]


def test_consume_exactly_balance_succeeds(client):
    """扣到刚好为 0 应成功，之后任意消耗都 402。"""
    balance = client.get(BASE).json()["balance"]
    assert client.post(f"{BASE}/consume", json={"skill": "清空", "cost": balance}).status_code == 200
    assert client.get(BASE).json()["balance"] == 0
    assert client.post(f"{BASE}/consume", json={"skill": "再扣", "cost": 1}).status_code == 402


def test_consume_invalid_payload_422(client):
    assert client.post(f"{BASE}/consume", json={"cost": 10}).status_code == 422
    assert client.post(f"{BASE}/consume", json={"skill": "x", "cost": -5}).status_code == 422


def test_grant_increases_balance_and_total(client):
    before = client.get(BASE).json()
    r = client.post(f"{BASE}/grant", json={"amount": 5000, "note": "按量充值 · 常用"})
    assert r.status_code == 200

    after = r.json()["credits"]
    assert after["balance"] == before["balance"] + 5000
    assert after["totalGranted"] == before["totalGranted"] + 5000


def test_grant_then_consume_recovers_from_402(client):
    """402 之后充值即可继续使用，验证付费门槛是「软墙」。"""
    balance = client.get(BASE).json()["balance"]
    client.post(f"{BASE}/consume", json={"skill": "清空", "cost": balance})
    assert client.post(f"{BASE}/consume", json={"skill": "再扣", "cost": 100}).status_code == 402

    client.post(f"{BASE}/grant", json={"amount": 1000, "note": "补充额度"})
    assert client.post(f"{BASE}/consume", json={"skill": "继续", "cost": 100}).status_code == 200


def test_grant_invalid_amount_422(client):
    assert client.post(f"{BASE}/grant", json={"amount": 0}).status_code == 422
    assert client.post(f"{BASE}/grant", json={"amount": -100}).status_code == 422


def test_logs_returns_grant_as_negative_cost(client):
    """充值流水以负数 cost 记录，前端据此显示为 +N。"""
    client.post(f"{BASE}/grant", json={"amount": 300, "note": "测试充值"})
    logs = client.get(f"{BASE}/logs").json()
    assert logs[0]["cost"] == -300


def test_logs_limit_respected(client):
    for i in range(5):
        client.post(f"{BASE}/consume", json={"skill": f"能力{i}", "cost": 10})
    logs = client.get(f"{BASE}/logs?limit=3").json()
    assert len(logs) == 3


def test_logs_ordered_newest_first(client):
    client.post(f"{BASE}/consume", json={"skill": "最早", "cost": 10})
    client.post(f"{BASE}/consume", json={"skill": "最新", "cost": 10})
    logs = client.get(f"{BASE}/logs").json()
    assert logs[0]["skill"] == "最新"
