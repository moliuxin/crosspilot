"""匿名独立站前台（/api/public/site）测试。

总指令要求「每家企业一套独立站点」，此前前台匿名访问会 401 →
前端回落到 mock → 所有企业都显示同一套 AQUAFLOW 内容。本测试证明：

- 匿名可读已发布站点（无需 token）
- 按租户渲染：A 的 slug 只返回 A 的内容
- 字段白名单：不泄露内部评分 / 询盘等
- 未发布 / 不存在的租户 → 404（防越权遍历）
"""
import pytest

from app import models

BASE = "/api"


def _publish(db_session, tenant_id: int, company: str = "") -> None:
    s = db_session.get(models.SiteState, tenant_id)
    if s is None:
        s = models.SiteState(id=tenant_id)
        db_session.add(s)
    s.publish_status = "published"
    if company:
        s.company_name = company
    db_session.commit()


def _slug_of(db_session, tenant_id: int) -> str:
    t = db_session.get(models.Tenant, tenant_id)
    return t.public_slug


# --------------------------------------------------------------------------


def test_public_site_requires_no_token(anon_client, db_session):
    """匿名即可访问已发布站点（独立站前台的核心前提）。"""
    _publish(db_session, models.DEFAULT_TENANT_ID, "AQUAFLOW Industrial")
    slug = _slug_of(db_session, models.DEFAULT_TENANT_ID)
    r = anon_client.get(f"{BASE}/public/site", params={"tenant": slug})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_public_site_renders_by_tenant(anon_client, owner_auth, db_session):
    """A 的 slug 只返回 A 的内容：租户隔离在公开接口上同样成立。"""
    c, headers, tenant_a = owner_auth
    _publish(db_session, tenant_a, "租户A 站点")

    data = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, tenant_a)}).json()
    assert data["tenant"]["name"] == "租户A公司" or "租户A" in data["brand"]["name"]
    # 默认租户的 slug 拿到的是另一套
    _publish(db_session, models.DEFAULT_TENANT_ID, "AQUAFLOW Industrial")
    other = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, models.DEFAULT_TENANT_ID)}).json()
    assert other["brand"]["name"] != data["brand"]["name"]


def test_public_site_exposes_products(anon_client, client, db_session):
    """已发布站点的产品随租户一起下发（前端产品区不再用 mock）。"""
    tenant_id = client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    client.post(f"{BASE}/products", json={"name": "Public Pump", "category": "Pump"})
    _publish(db_session, tenant_id)

    data = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, tenant_id)}).json()
    names = [p["name"] for p in data["products"]]
    assert "Public Pump" in names


def test_public_site_product_field_whitelist(anon_client, client, db_session):
    """绝不泄露内部指标与私密数据。"""
    tenant_id = client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    client.post(f"{BASE}/products", json={"name": "Whitelist Pump", "category": "Pump"})
    _publish(db_session, tenant_id)

    data = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, tenant_id)}).json()
    p = data["products"][0]
    for leaked in ("seo_score", "geo_score", "inquiries", "inquiries_count"):
        assert leaked not in p
    # 顶层也不能出现询盘 / 用户 / 额度
    for leaked in ("inquiries", "users", "credits", "drafts", "versions"):
        assert leaked not in data


def test_public_site_unpublished_returns_404(anon_client, owner_auth, db_session):
    """未发布站点不可读 —— 防止猜 slug 读到未上线内容。"""
    _, _, tenant_a = owner_auth
    # owner_auth 的租户默认 publish_status = draft
    r = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, tenant_a)})
    assert r.status_code == 404


def test_public_site_unknown_slug_404(anon_client):
    assert anon_client.get(f"{BASE}/public/site", params={"tenant": "t-nope-xxx"}).status_code == 404


def test_public_site_accepts_numeric_id_but_still_guards_publish(anon_client, owner_auth):
    """兼容数字 id，但未发布仍然 404。"""
    _, _, tenant_a = owner_auth
    r = anon_client.get(f"{BASE}/public/site", params={"tenant": str(tenant_a)})
    assert r.status_code == 404  # 未发布


def test_public_slug_is_generated_and_unguessable(owner_auth, db_session):
    """slug 不可枚举：带随机后缀。"""
    _, _, tenant_a = owner_auth
    slug = _slug_of(db_session, tenant_a)
    assert slug.startswith("t-")
    assert len(slug) > 8


def test_public_site_home_sections(anon_client, client, db_session):
    """首页区块随站点公开，供前台按结构渲染。"""
    tenant_id = client.get(f"{BASE}/auth/me").json()["user"]["tenantId"]
    # 页面由 GET /pages 懒初始化，先触发一次
    assert client.get(f"{BASE}/pages").status_code == 200
    _publish(db_session, tenant_id)
    data = anon_client.get(f"{BASE}/public/site", params={"tenant": _slug_of(db_session, tenant_id)}).json()
    assert "pages" in data
    assert data["home"] is not None
    assert isinstance(data["home"]["sections"], list)
