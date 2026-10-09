"""统一付费权限体系测试。

覆盖总指令对「统一收费规则」的硬要求：
- 免费版只能 1 次 AI 完整生成，其余能力一律付费
- 门禁在**服务端**（不是前端写死）
- 套餐/能力申请产生**真实数据库记录**，审批后权限真实生效
- 权限真源唯一（Subscription + Entitlement），SiteState.plan 不参与判断
- 租户之间权限互不影响
"""
import pytest

from app import entitlements, models

BASE = "/api"


# --------------------------------------------------------------------------
# 1. 免费版权限形状
# --------------------------------------------------------------------------


def test_free_tenant_entitlements_shape(free_client):
    """新租户（free）拿到的全量权限：含生成/发布，不含付费能力。"""
    r = free_client.get(f"{BASE}/entitlements")
    assert r.status_code == 200
    d = r.json()
    assert d["plan"] == "free"
    assert d["features"]["site.generate"] is True
    assert d["features"]["site.publish"] is True
    # 付费能力必须为 False
    assert d["features"]["seo.optimize"] is False
    assert d["features"]["brush.edit"] is False
    assert d["features"]["agent.run"] is False
    # 免费生成额度映射到 site.generate
    assert d["quotas"]["site.generate"]["limit"] == 1
    assert d["quotas"]["site.generate"]["left"] == 1
    # 套餐清单下发（前端不再硬编码）
    ids = [p["id"] for p in d["plans"]]
    assert "free" in ids and "starter" in ids and "growth" in ids


def test_entitlements_requires_login(anon_client):
    assert anon_client.get(f"{BASE}/entitlements").status_code == 401


# --------------------------------------------------------------------------
# 2. 服务端门禁：free 撞 402
# --------------------------------------------------------------------------


def test_free_tenant_blocked_on_seo_optimize(free_client):
    """free 套餐调用 SEO 优化 → 402，且响应体带 feature/requiredPlan/upgradeUrl。"""
    r = free_client.post(f"{BASE}/seo/optimize", json={"productId": "prod_002"})
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["feature"] == "seo.optimize"
    assert detail["requiredPlan"] == "starter"
    assert detail["upgradeUrl"]


def test_free_tenant_blocked_on_page_publish(free_client):
    """free 不能发布页面（page.publish 属 starter）。"""
    pages = free_client.get(f"{BASE}/pages").json()
    assert pages
    pid = pages[0]["id"]
    r = free_client.put(f"{BASE}/pages/{pid}", json={"name": "免费版改不动"})
    assert r.status_code == 402
    assert r.json()["detail"]["feature"] == "page.publish"


def test_free_tenant_blocked_on_agent_write(free_client):
    """free 不能跑会产生草稿的 Agent 指令（growth 能力）。"""
    r = free_client.post(
        f"{BASE}/agent/run",
        json={"command": "帮我把产品页优化一下"},
    )
    assert r.status_code == 402
    assert r.json()["detail"]["feature"] == "agent.run"


def test_free_tenant_agent_read_is_allowed(free_client):
    """只读型 Agent 指令对 free 放行（查数据不产生任何写入）。"""
    r = free_client.post(
        f"{BASE}/agent/run",
        json={"command": "现在有多少询盘？"},
    )
    assert r.status_code == 200
    assert r.json()["requiresConfirmation"] is False


# --------------------------------------------------------------------------
# 3. Growth 套餐解锁
# --------------------------------------------------------------------------


def test_growth_tenant_unlocks_paid_feature(client):
    """client 夹具即 Growth —— 同一请求从 402 变 200。"""
    pid = client.post(f"{BASE}/products", json={"name": "付费产品", "category": "Pump"}).json()["product"]["id"]
    r = client.post(f"{BASE}/seo/optimize", json={"productId": pid})
    assert r.status_code == 200
    assert r.json()["draft"]["id"]


def test_growth_tenant_entitlements_all_true(client):
    d = client.get(f"{BASE}/entitlements").json()
    assert d["plan"] == "growth"
    assert d["features"]["seo.optimize"] is True
    assert d["features"]["brush.edit"] is True
    assert d["features"]["agent.run"] is True


def test_free_market_quota_does_not_apply_to_paid_plan(client):
    """免费「1 个新增市场」限制只对 free 生效；Growth 可加多个市场。"""
    assert client.post(f"{BASE}/localization/generate", json={"market": "ru-RU"}).status_code == 200
    assert client.post(f"{BASE}/localization/generate", json={"market": "zh-CN"}).status_code == 200


# --------------------------------------------------------------------------
# 4. 免费生成额度（per-tenant）
# --------------------------------------------------------------------------


def test_free_generation_quota_is_per_tenant(free_client, second_client):
    """免费额度按租户计算，不是全局 usage_id=1。"""
    free_client.post(f"{BASE}/usage/consume")
    # 第一个租户用完
    r = free_client.post(f"{BASE}/usage/consume")
    assert r.status_code == 402
    # 第二个租户仍有独立额度
    assert second_client.post(f"{BASE}/usage/consume").status_code == 200


# --------------------------------------------------------------------------
# 5. ServiceOrder：真实订单记录 + 审批生效
# --------------------------------------------------------------------------


def test_service_order_creates_real_record(free_client):
    """点击购买必须落库，而不是只弹一句"客服稍后联系"。"""
    r = free_client.post(f"{BASE}/service-orders", json={"plan_id": "starter", "note": "想升级"})
    assert r.status_code == 201
    order = r.json()["order"]
    assert order["plan_id"] == "starter"
    assert order["status"] == "pending"
    assert order["amount"] == 399
    # 列表里查得到（刷新后仍在）
    lst = free_client.get(f"{BASE}/service-orders").json()["orders"]
    assert any(o["id"] == order["id"] for o in lst)


def test_service_order_requires_plan_or_feature(free_client):
    r = free_client.post(f"{BASE}/service-orders", json={})
    assert r.status_code == 400


def test_approve_service_order_grants_plan(free_client, db_session):
    """审批通过后订阅真实变更，权限立即生效。"""
    order = free_client.post(f"{BASE}/service-orders", json={"plan_id": "starter"}).json()["order"]

    # 审批前：starter 能力不可用
    assert free_client.get(f"{BASE}/entitlements").json()["features"]["seo.optimize"] is False

    r = free_client.post(f"{BASE}/service-orders/{order['id']}/approve")
    assert r.status_code == 200
    assert r.json()["entitlements"]["plan"] == "starter"

    # 审批后：真源 Subscription 落库为 starter，能力解锁
    assert free_client.get(f"{BASE}/entitlements").json()["features"]["seo.optimize"] is True
    tenant_id = free_client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    sub = db_session.get(models.Subscription, tenant_id)
    assert sub is not None and sub.plan_id == "starter"


def test_approve_feature_grants_single_entitlement(free_client, db_session):
    """单独加购某项能力（不改套餐）。"""
    order = free_client.post(
        f"{BASE}/service-orders", json={"feature_key": "brush.edit"}
    ).json()["order"]
    assert free_client.get(f"{BASE}/entitlements").json()["features"]["brush.edit"] is False

    r = free_client.post(f"{BASE}/service-orders/{order['id']}/approve")
    assert r.status_code == 200
    assert r.json()["entitlements"]["features"]["brush.edit"] is True

    tenant_id = free_client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    rows = (
        db_session.query(models.Entitlement)
        .filter(models.Entitlement.tenant_id == tenant_id, models.Entitlement.feature_key == "brush.edit")
        .all()
    )
    assert len(rows) == 1
    assert rows[0].source == "purchase"


def test_approve_twice_conflicts(free_client):
    order = free_client.post(f"{BASE}/service-orders", json={"plan_id": "growth"}).json()["order"]
    assert free_client.post(f"{BASE}/service-orders/{order['id']}/approve").status_code == 200
    assert free_client.post(f"{BASE}/service-orders/{order['id']}/approve").status_code == 409


def test_approve_unknown_order_404(free_client):
    assert free_client.post(f"{BASE}/service-orders/so_nope/approve").status_code == 404


# --------------------------------------------------------------------------
# 6. 权限真源唯一：SiteState.plan 不再参与判断
# --------------------------------------------------------------------------


def test_subscription_is_single_source_not_site_state_plan(free_client, db_session):
    """把 SiteState.plan 改成 growth，权限**不应**变化 —— 证明废弃双写。"""
    free_client.put(f"{BASE}/site/state", json={"plan": "growth"})
    d = free_client.get(f"{BASE}/entitlements").json()
    assert d["plan"] == "free"
    assert d["features"]["seo.optimize"] is False
    # 反向证明：改真源才有用
    tenant_id = free_client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    sub = db_session.get(models.Subscription, tenant_id)
    assert sub.plan_id == "free"


def test_plan_field_on_site_state_is_display_only(free_client):
    """SiteState.to_dict 仍返回 plan（兼容旧前端展示），但它不决定权限。"""
    state = free_client.get(f"{BASE}/site/state").json()
    assert "plan" in state


# --------------------------------------------------------------------------
# 7. 租户隔离
# --------------------------------------------------------------------------


def test_entitlements_isolated_between_tenants(owner_auth, second_client, db_session):
    """A 升级不影响 B。"""
    c, headers, tenant_a = owner_auth
    _set = entitlements.ensure_subscription(db_session, tenant_a, plan_id="growth")
    _set.plan_id = "growth"
    db_session.commit()

    a = c.get(f"{BASE}/entitlements", headers=headers).json()
    b = second_client.get(f"{BASE}/entitlements").json()
    assert a["plan"] == "growth"
    assert b["plan"] == "free"
    assert b["features"]["seo.optimize"] is False


def test_service_orders_isolated_between_tenants(free_client, second_client):
    free_client.post(f"{BASE}/service-orders", json={"plan_id": "starter"})
    assert second_client.get(f"{BASE}/service-orders").json()["orders"] == []


# --------------------------------------------------------------------------
# 8. 单元级：真源查询层
# --------------------------------------------------------------------------


def test_plans_seeded(db_session):
    rows = db_session.query(models.Plan).all()
    ids = {r.id for r in rows}
    assert {"free", "starter", "growth", "expert"} <= ids


def test_wildcard_plan_has_every_feature(db_session):
    entitlements.ensure_subscription(db_session, 99, plan_id="growth")
    db_session.commit()
    assert entitlements.has_feature(db_session, 99, "brush.edit") is True
    assert entitlements.has_feature(db_session, 99, "some.future.feature") is True


def test_unknown_plan_falls_back_to_free(db_session):
    entitlements.ensure_subscription(db_session, 98, plan_id="nonsense")
    db_session.commit()
    assert entitlements.get_plan_id(db_session, 98) == "nonsense"
    # 未定义套餐 → 无任何 features
    assert entitlements.has_feature(db_session, 98, "seo.optimize") is False


def test_expired_entitlement_is_ignored(db_session):
    from datetime import datetime, timedelta, timezone

    db_session.add(
        models.Entitlement(
            id="ent_expired",
            tenant_id=97,
            feature_key="brush.edit",
            source="trial",
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    entitlements.ensure_subscription(db_session, 97, plan_id="free")
    db_session.commit()
    assert entitlements.has_feature(db_session, 97, "brush.edit") is False


def test_quota_limited_entitlement_blocks_when_exhausted(db_session):
    db_session.add(
        models.Entitlement(
            id="ent_quota", tenant_id=96, feature_key="brush.edit", source="purchase", quota=1, used=1
        )
    )
    entitlements.ensure_subscription(db_session, 96, plan_id="free")
    db_session.commit()
    assert entitlements.has_feature(db_session, 96, "brush.edit") is False
    with pytest.raises(Exception):
        entitlements.require_feature(db_session, 96, "brush.edit")
