"""版本历史测试：聚合端点 + 页面编辑产版本 + 真回滚。

总指令要求「每次发布/编辑都产生版本记录，且支持预览/对比/恢复」。
此前 PUT /pages/{id} 直接改库不记版本 —— 页面回滚形同虚设，本测试堵住这个洞。
"""
from app import models

BASE = "/api"


def _make_product(client, name: str) -> str:
    r = client.post(f"{BASE}/products", json={"name": name, "category": "Pump"})
    assert r.status_code == 201, r.text
    return r.json()["product"]["id"]


def _make_draft_and_publish(client, product_id: str) -> dict:
    """跑一次 SEO 优化 → 发布，产出真实版本记录。"""
    d = client.post(f"{BASE}/seo/optimize", json={"productId": product_id}).json()["draft"]
    r = client.post(f"{BASE}/publish", json={"draft_id": d["id"], "human_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# 聚合端点
# --------------------------------------------------------------------------


def test_recent_versions_aggregates_all_entities(client):
    """列表页需要一个不限定实体的版本流。"""
    p1 = _make_product(client, "聚合产品一")
    p2 = _make_product(client, "聚合产品二")
    _make_draft_and_publish(client, p1)
    _make_draft_and_publish(client, p2)

    r = client.get(f"{BASE}/versions/recent")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 2
    entity_ids = {v["entity_id"] for v in items}
    assert {p1, p2} <= entity_ids


def test_recent_versions_sorted_desc(client):
    p1 = _make_product(client, "排序产品一")
    p2 = _make_product(client, "排序产品二")
    _make_draft_and_publish(client, p1)
    _make_draft_and_publish(client, p2)
    items = client.get(f"{BASE}/versions/recent").json()
    times = [v["created_at"] for v in items]
    assert times == sorted(times, reverse=True)


def test_recent_versions_limit(client):
    pids = [_make_product(client, f"限量产品{i}") for i in range(4)]
    for pid in pids:
        _make_draft_and_publish(client, pid)
    items = client.get(f"{BASE}/versions/recent", params={"limit": 2}).json()
    assert len(items) == 2


def test_recent_versions_isolated_between_tenants(client, second_client):
    """A 记一条，B 看不到。"""
    p1 = _make_product(client, "隔离产品")
    _make_draft_and_publish(client, p1)
    b = second_client.get(f"{BASE}/versions/recent").json()
    assert all(v["entity_id"] != p1 for v in b)


def test_recent_versions_requires_login(anon_client):
    assert anon_client.get(f"{BASE}/versions/recent").status_code == 401


def test_recent_route_not_shadowed_by_version_id(client):
    """/versions/recent 必须命中聚合端点，而不是被 /versions/{id} 吃掉。"""
    r = client.get(f"{BASE}/versions/recent")
    assert r.status_code == 200
    assert isinstance(r.json(), list)  # 若被吃掉会返回 404 detail


# --------------------------------------------------------------------------
# 页面编辑产版本
# --------------------------------------------------------------------------


def test_page_edit_creates_version_record(client):
    """页面编辑保存必须留下版本记录（回归：此前不记）。"""
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]

    before = client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json()

    r = client.put(f"{BASE}/pages/{pid}", json={"name": "改名后的首页"})
    assert r.status_code == 200

    after = client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json()
    assert len(after) == len(before) + 1
    assert after[0]["action"] == "edit"


def test_page_edit_version_has_snapshots(client):
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]
    client.put(f"{BASE}/pages/{pid}", json={"name": "改名后的首页"})

    v = client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json()[0]
    detail = client.get(f"{BASE}/versions/{v['id']}").json()
    assert detail["before_snapshot"]["name"] != detail["after_snapshot"]["name"]
    assert detail["after_snapshot"]["name"] == "改名后的首页"


def test_page_edit_noop_does_not_create_version(client):
    """内容没变不该产生噪声版本。"""
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]
    client.put(f"{BASE}/pages/{pid}", json={"name": "稳定标题"})
    n1 = len(client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json())
    client.put(f"{BASE}/pages/{pid}", json={"name": "稳定标题"})
    n2 = len(client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json())
    assert n1 == n2


def test_sections_change_creates_version(client):
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]
    n1 = len(client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json())
    client.put(
        f"{BASE}/pages/{pid}",
        json={"sections": [{"id": "sec_new", "type": "hero", "props": {"title": "新标题"}}]},
    )
    n2 = len(client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json())
    assert n2 == n1 + 1


# --------------------------------------------------------------------------
# 真回滚
# --------------------------------------------------------------------------


def test_rollback_page_edit_restores_name(client):
    """回滚 pages 编辑版本：名称真的恢复（不是只返回 rolled_back）。"""
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]
    original = pages[0]["name"]

    client.put(f"{BASE}/pages/{pid}", json={"name": "被改坏的标题"})
    assert client.get(f"{BASE}/pages/{pid}").json()["name"] == "被改坏的标题"

    v = client.get(f"{BASE}/versions", params={"entity_type": "page", "entity_id": pid}).json()[0]
    r = client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "page", "entity_id": pid, "version_id": v["id"]},
    )
    assert r.status_code == 200
    assert r.json()["rolled_back"] is True
    assert client.get(f"{BASE}/pages/{pid}").json()["name"] == original


def test_rollback_records_new_version(client):
    """回滚本身也要留痕（action=rollback）。"""
    pid = _make_product(client, "回滚留痕产品")
    _make_draft_and_publish(client, pid)
    v = client.get(f"{BASE}/versions", params={"entity_type": "product", "entity_id": pid}).json()[0]
    client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "product", "entity_id": pid, "version_id": v["id"]},
    )
    items = client.get(f"{BASE}/versions", params={"entity_type": "product", "entity_id": pid}).json()
    assert items[0]["action"] == "rollback"


def test_rollback_unknown_version_404(client):
    pid = _make_product(client, "未知版本产品")
    r = client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "product", "entity_id": pid, "version_id": "ver_nope"},
    )
    assert r.status_code == 404


def test_rollback_isolated_between_tenants(client, second_client):
    """B 不能回滚 A 的版本。"""
    pid = _make_product(client, "跨租户回滚产品")
    _make_draft_and_publish(client, pid)
    v = client.get(f"{BASE}/versions", params={"entity_type": "product", "entity_id": pid}).json()[0]
    r = second_client.post(
        f"{BASE}/versions/rollback",
        json={"entity_type": "product", "entity_id": pid, "version_id": v["id"]},
    )
    assert r.status_code == 404
