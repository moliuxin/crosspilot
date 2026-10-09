"""账户系统与多租户隔离测试。

核心安全断言（这是审计 P1 的关键）：
  - 未登录访问业务端点 → 401（不能再裸奔）
  - A 租户看不到 B 租户的产品 / 询盘 / 草稿
  - 普通商家传 X-Tenant-Id 越权无效（必须忽略客户端指定）
  - 密码不明文存储；错误密码不区分「账号不存在/密码错」
  - 新租户不会看到默认租户的存量数据
"""
from __future__ import annotations

import pytest

from app import models

pytestmark = pytest.mark.usefixtures("client")


def _register(client, email, company):
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": "secret123", "company_name": company, "industry": "测试行业"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["token"], body["user"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- 注册 / 登录 ----------------

def test_register_creates_tenant_and_owner(client):
    token, user = _register(client, "owner_a@test.com", "Alpha Works")
    assert user["role"] == "owner"
    assert user["tenantId"] == user["tenant"]["id"]
    assert user["tenant"]["name"] == "Alpha Works"
    assert token


def test_register_duplicate_email_409(client):
    _register(client, "dup@test.com", "Dup Co")
    r = client.post(
        "/api/auth/register",
        json={"email": "Dup@Test.com", "password": "secret123", "company_name": "Dup2"},
    )
    assert r.status_code == 409


def test_login_ok_and_wrong_password_401(client):
    _register(client, "login@test.com", "Login Co")
    ok = client.post("/api/auth/login", json={"email": "login@test.com", "password": "secret123"})
    assert ok.status_code == 200 and ok.json()["token"]

    bad_pw = client.post("/api/auth/login", json={"email": "login@test.com", "password": "wrong"})
    assert bad_pw.status_code == 401
    # 不存在的账号与密码错误返回同一文案（防账号枚举）
    no_user = client.post("/api/auth/login", json={"email": "nobody@test.com", "password": "whatever"})
    assert no_user.status_code == 401
    assert bad_pw.json()["detail"] == no_user.json()["detail"]


def test_password_is_hashed_not_plaintext(client, db_session):
    _register(client, "hash@test.com", "Hash Co")
    u = db_session.query(models.User).filter(models.User.email == "hash@test.com").first()
    assert u is not None
    assert u.password_hash != "secret123"
    assert u.password_hash.startswith("$2")  # bcrypt


def test_me_requires_token(anon_client):
    assert anon_client.get("/api/auth/me").status_code == 401
    token, _ = _register(anon_client, "me@test.com", "Me Co")
    r = anon_client.get("/api/auth/me", headers=_auth(token))
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "me@test.com"


def test_invalid_token_401(anon_client):
    assert anon_client.get("/api/auth/me", headers=_auth("not-a-real-token")).status_code == 401


# ---------------- 业务端点必须登录 ----------------

def test_business_endpoints_require_login(anon_client):
    paths = (
        "/api/products",
        "/api/inquiries",
        "/api/pages",
        "/api/drafts",
        "/api/company",
        "/api/tasks",
        "/api/credits",
        "/api/usage",
        "/api/site/state",
        "/api/health",
        "/api/health/site",
        "/api/metrics",
        "/api/localization",
    )
    for path in paths:
        assert anon_client.get(path).status_code == 401, f"{path} 未鉴权即可访问"


def test_anonymous_rfq_submission_still_allowed(anon_client, db_session):
    """独立站询盘表单是唯一允许匿名写入的入口 —— 不能被鉴权误伤。"""
    r = anon_client.post(
        "/api/inquiries",
        json={"name": "Walk-in Buyer", "email": "walkin@buyer.com", "message": "Need a quote"},
    )
    assert r.status_code in (200, 201), r.text
    iid = r.json()["inquiry"]["id"]
    row = db_session.get(models.Inquiry, iid)
    assert row.tenant_id == models.DEFAULT_TENANT_ID, "匿名询盘应落默认租户"


def test_anonymous_rfq_cannot_target_arbitrary_tenant_via_merchant_token(client, db_session):
    """商家带着自己的 token 提交询盘 → 必须落自己的租户，而不是 X-Tenant-Id 指定的别人。"""
    tok_a, user_a = _register(client, "rfqa@shop.com", "RFQ A")
    tok_b, user_b = _register(client, "rfqb@shop.com", "RFQ B")

    r = client.post(
        "/api/inquiries",
        json={"name": "Sneaky Buyer", "email": "s@x.com", "message": "quote"},
        headers={**_auth(tok_a), "X-Tenant-Id": str(user_b["tenantId"])},
    )
    assert r.status_code in (200, 201), r.text
    row = db_session.get(models.Inquiry, r.json()["inquiry"]["id"])
    assert row.tenant_id == user_a["tenantId"], "越权：商家把询盘塞进了别的租户"

    b_list = client.get("/api/inquiries", headers=_auth(tok_b)).json()["inquiries"]
    assert all(i["customer_name"] != "Sneaky Buyer" for i in b_list), "跨租户泄漏：B 收到了 A 的询盘"


# ---------------- 租户隔离（核心） ----------------

def test_products_isolated_between_tenants(client):
    tok_a, _ = _register(client, "a@shop.com", "Shop A")
    tok_b, _ = _register(client, "b@shop.com", "Shop B")

    created = client.post(
        "/api/products",
        json={"name": "Alpha Pump", "model": "AP-1", "category": "Pumps"},
        headers=_auth(tok_a),
    )
    assert created.status_code == 201, created.text
    pid = created.json()["product"]["id"]

    a_list = client.get("/api/products", headers=_auth(tok_a)).json()
    a_products = a_list if isinstance(a_list, list) else a_list.get("items", [])
    assert any(p["id"] == pid for p in a_products)

    # B 看不到 A 的产品
    b_list = client.get("/api/products", headers=_auth(tok_b)).json()
    b_products = b_list if isinstance(b_list, list) else b_list.get("items", [])
    assert not any(p["id"] == pid for p in b_products), "跨租户泄漏：B 看到了 A 的产品"

    # B 按 id 直接取 A 的产品 → 404（不泄露存在性）
    assert client.get(f"/api/products/{pid}", headers=_auth(tok_b)).status_code == 404
    # A 自己取 → 200
    assert client.get(f"/api/products/{pid}", headers=_auth(tok_a)).status_code == 200


def test_new_tenant_does_not_see_default_tenant_seed_data(client, db_session):
    """存量数据属于默认租户；新注册的商家进入时应该是干净的工作台。"""
    seeded = db_session.query(models.Product).filter(models.Product.tenant_id == models.DEFAULT_TENANT_ID).count()
    assert seeded > 0, "前置条件：默认租户应有种子数据"

    tok, user = _register(client, "fresh@shop.com", "Fresh Co")
    assert user["tenantId"] != models.DEFAULT_TENANT_ID

    items = client.get("/api/products", headers=_auth(tok)).json()
    assert items == [], f"新租户看到了默认租户的 {len(items)} 个产品"


def test_inquiries_isolated_between_tenants(client):
    tok_a, _ = _register(client, "ia@shop.com", "Inq A")
    tok_b, _ = _register(client, "ib@shop.com", "Inq B")

    created = client.post(
        "/api/inquiries",
        json={"name": "Buyer A", "email": "buyer@a.com", "message": "Need pumps"},
        headers=_auth(tok_a),
    )
    assert created.status_code in (200, 201), created.text

    a_data = client.get("/api/inquiries", headers=_auth(tok_a)).json()
    a_list = a_data.get("inquiries", a_data) if isinstance(a_data, dict) else a_data
    assert len(a_list) == 1, a_data

    b_data = client.get("/api/inquiries", headers=_auth(tok_b)).json()
    b_list = b_data.get("inquiries", b_data) if isinstance(b_data, dict) else b_data
    assert b_list == [], "跨租户泄漏：B 看到了 A 的询盘"


def test_drafts_isolated_between_tenants(client):
    tok_a, _ = _register(client, "da@shop.com", "Draft A")
    tok_b, _ = _register(client, "db@shop.com", "Draft B")

    pid = client.post(
        "/api/products",
        json={"name": "Gamma Valve", "model": "GV-1"},
        headers=_auth(tok_a),
    ).json()["product"]["id"]

    d = client.post(
        "/api/drafts",
        json={"entity_type": "product", "entity_id": pid, "patch": {"seo": {"title": "A only"}}, "title": "A draft"},
        headers=_auth(tok_a),
    )
    assert d.status_code in (200, 201), d.text
    draft_id = d.json()["draft"]["id"]

    a_drafts = client.get("/api/drafts", headers=_auth(tok_a)).json()
    a_list = a_drafts.get("drafts", a_drafts) if isinstance(a_drafts, dict) else a_drafts
    assert any(x["id"] == draft_id for x in a_list)

    b_drafts = client.get("/api/drafts", headers=_auth(tok_b)).json()
    b_list = b_drafts.get("drafts", b_drafts) if isinstance(b_drafts, dict) else b_drafts
    assert not any(x["id"] == draft_id for x in b_list), "跨租户泄漏：B 看到了 A 的草稿"

    # B 也不能对 A 的产品建草稿（实体不可见 → 404）
    cross = client.post(
        "/api/drafts",
        json={"entity_type": "product", "entity_id": pid, "patch": {"seo": {"title": "hijack"}}},
        headers=_auth(tok_b),
    )
    assert cross.status_code == 404, "越权：B 能对 A 的产品建草稿"


def test_cross_tenant_publish_blocked(client):
    """B 拿到 A 的 draft_id 也不能发布 —— 草稿查询按租户过滤。"""
    tok_a, _ = _register(client, "pa@shop.com", "Pub A")
    tok_b, _ = _register(client, "pb@shop.com", "Pub B")

    pid = client.post(
        "/api/products", json={"name": "Pub Valve", "model": "PV-1"}, headers=_auth(tok_a)
    ).json()["product"]["id"]
    draft_id = client.post(
        "/api/drafts",
        json={"entity_type": "product", "entity_id": pid, "patch": {"seo": {"title": "A only title"}}},
        headers=_auth(tok_a),
    ).json()["draft"]["id"]

    r = client.post(
        "/api/publish",
        json={"draft_id": draft_id, "human_confirmed": True},
        headers=_auth(tok_b),
    )
    assert r.status_code == 404, "越权：B 发布了 A 的草稿"


def test_client_supplied_tenant_header_is_ignored_for_merchant(client):
    """普通商家伪造 X-Tenant-Id 想读别人数据 —— 必须被忽略。"""
    tok_a, user_a = _register(client, "xa@shop.com", "X A")
    tok_b, _user_b = _register(client, "xb@shop.com", "X B")

    client.post(
        "/api/products",
        json={"name": "Secret Product", "model": "SP-1"},
        headers=_auth(tok_a),
    )
    sneaky = client.get("/api/products", headers={**_auth(tok_b), "X-Tenant-Id": str(user_a["tenantId"])})
    assert sneaky.status_code == 200
    data = sneaky.json()
    items = data if isinstance(data, list) else data.get("items", [])
    assert not any(p["name"] == "Secret Product" for p in items), "越权：X-Tenant-Id 头绕过了租户隔离"


def test_each_tenant_has_own_site_state(client):
    tok_a, _ = _register(client, "sa@shop.com", "Site A")
    tok_b, _ = _register(client, "sb@shop.com", "Site B")

    upd = client.put(
        "/api/site/state",
        json={"companyName": "Site A Only", "industry": "A 行业"},
        headers=_auth(tok_a),
    )
    assert upd.status_code == 200, upd.text

    a_state = client.get("/api/site/state", headers=_auth(tok_a)).json()
    b_state = client.get("/api/site/state", headers=_auth(tok_b)).json()
    assert a_state.get("companyName") == "Site A Only"
    assert b_state.get("companyName") != "Site A Only", "跨租户泄漏：站点设置共享"


def test_each_tenant_has_own_usage_quota(client):
    """免费额度是每租户独立的，不能被一个租户刷爆影响别人。"""
    tok_a, _ = _register(client, "ua@shop.com", "Usage A")
    tok_b, _ = _register(client, "ub@shop.com", "Usage B")

    before_b = client.get("/api/usage", headers=_auth(tok_b)).json()
    r = client.post("/api/usage/consume", headers=_auth(tok_a))
    assert r.status_code == 200, r.text

    after_b = client.get("/api/usage", headers=_auth(tok_b)).json()
    assert after_b == before_b, "跨租户泄漏：A 消耗额度影响到了 B"

    after_a = client.get("/api/usage", headers=_auth(tok_a)).json()
    assert after_a != before_b, "A 自己的额度没有变化"
