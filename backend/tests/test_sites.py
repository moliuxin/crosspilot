"""P0-MULTI-SITE 多站点架构测试。

核心断言（对应指令）：
- 1 user / tenant → multiple sites；
- GET/POST /api/sites、GET/PATCH/DELETE /api/sites/{id}，必须租户隔离；
- 旧租户数据自动归属 Default Site，不丢；
- Site A 与 Site B 的页面数据隔离，刷新（重新查询）后仍存在；
- 产品经 SiteProduct 关联复用，不复制事实；
- 免费生成额度是账号级（Usage 单例），不因多站点重复。
"""
import pytest

from app import models


# ---------------- 基础 CRUD ----------------

def test_new_account_starts_with_zero_sites(client):
    """新注册账号默认没有站点 —— 站点由用户显式创建，不隐式建站。"""
    res = client.get("/api/sites")
    assert res.status_code == 200
    assert res.json()["sites"] == []


def test_create_site_and_isolation_between_sites(client):
    """创建 Site A / Site B：各自有独立页面集合，互不可见。"""
    a = client.post("/api/sites", json={"name": "工业水泵站", "industry": "工业泵", "target_markets": ["en-US", "ru-RU"]})
    assert a.status_code == 201, a.text
    site_a = a.json()["site"]
    assert site_a["name"] == "工业水泵站"
    assert site_a["status"] == "draft"

    b = client.post("/api/sites", json={"name": "食品出口站", "industry": "食品"})
    assert b.status_code == 201
    site_b = b.json()["site"]

    assert site_a["id"] != site_b["id"]

    # 各站点自动播种了自己的页面
    pages_a = client.get(f"/api/pages?site_id={site_a['id']}").json()
    pages_b = client.get(f"/api/pages?site_id={site_b['id']}").json()
    assert len(pages_a) >= 1 and len(pages_b) >= 1
    ids_a = {p["id"] for p in pages_a}
    ids_b = {p["id"] for p in pages_b}
    assert ids_a.isdisjoint(ids_b), "Site A 与 Site B 的页面必须隔离"

    # 在 A 里新建页面不会出现在 B
    created = client.post(f"/api/pages?site_id={site_a['id']}", json={"name": "A 专属页"})
    assert created.status_code == 201
    page_id = created.json()["page"]["id"]
    assert page_id not in {p["id"] for p in client.get(f"/api/pages?site_id={site_b['id']}").json()}


def test_site_persistence_across_requests(client):
    """刷新等价验证：重新查询后两个站点仍存在。"""
    for name in ("Site A", "Site B"):
        assert client.post("/api/sites", json={"name": name}).status_code == 201
    sites = client.get("/api/sites").json()["sites"]
    names = {s["name"] for s in sites}
    assert {"Site A", "Site B"} <= names
    # 再次拉取（模拟刷新）
    again = client.get("/api/sites").json()["sites"]
    assert {s["id"] for s in again} == {s["id"] for s in sites}


def test_duplicate_site_name_rejected(client):
    assert client.post("/api/sites", json={"name": "重复站"}).status_code == 201
    dup = client.post("/api/sites", json={"name": "重复站"})
    assert dup.status_code == 409


def test_get_patch_site(client):
    created = client.post("/api/sites", json={"name": "机械设备俄罗斯站", "product_category": "机械设备"}).json()["site"]
    got = client.get(f"/api/sites/{created['id']}").json()["site"]
    assert got["product_category"] == "机械设备"

    patched = client.patch(f"/api/sites/{created['id']}", json={"name": "俄罗斯机械站", "target_markets": ["ru-RU"], "status": "published"})
    assert patched.status_code == 200
    body = patched.json()["site"]
    assert body["name"] == "俄罗斯机械站"
    assert body["target_markets"] == ["ru-RU"]
    assert body["status"] == "published"


def test_delete_site(client):
    site = client.post("/api/sites", json={"name": "待删站"}).json()["site"]
    page_id = client.get(f"/api/pages?site_id={site['id']}").json()[0]["id"]

    res = client.delete(f"/api/sites/{site['id']}")
    assert res.status_code == 200
    assert client.get(f"/api/sites/{site['id']}").status_code == 404
    # 站点的页面随站点删除
    assert client.get(f"/api/pages/{page_id}").status_code == 404


# ---------------- 租户隔离（硬约束） ----------------

def test_sites_tenant_isolation(owner_auth, second_client):
    """跨租户访问他人站点一律 404（不泄露存在性）。"""
    c, headers, _ = owner_auth
    created = c.post("/api/sites", json={"name": "主租户站点"}, headers=headers)
    assert created.status_code == 201
    site_id = created.json()["site"]["id"]

    assert second_client.get(f"/api/sites/{site_id}").status_code == 404
    assert second_client.patch(f"/api/sites/{site_id}", json={"name": "抢占"}).status_code == 404
    assert second_client.delete(f"/api/sites/{site_id}").status_code == 404
    # 站点作用域的页面列表也必须校验归属
    assert second_client.get(f"/api/pages?site_id={site_id}").status_code == 404
    # 第二租户看不到第一租户的站点
    assert all(s["id"] != site_id for s in second_client.get("/api/sites").json()["sites"])


def test_sites_require_login(anon_client):
    assert anon_client.get("/api/sites").status_code == 401
    assert anon_client.post("/api/sites", json={"name": "x"}).status_code == 401


# ---------------- 旧数据迁移 ----------------

def test_seed_tenant_default_site_backfill(seed_client, db_session):
    """种子租户：默认站点存在，老页面/询盘已归属它，产品已关联。"""
    sites = seed_client.get("/api/sites").json()["sites"]
    assert len(sites) >= 1
    default = next(s for s in sites if s["is_default"])
    assert default["name"]

    pages = seed_client.get(f"/api/pages?site_id={default['id']}").json()
    assert len(pages) >= 6, "旧租户的默认页面应归属默认站点"

    inquiries = db_session.query(models.Inquiry).filter(models.Inquiry.tenant_id == models.DEFAULT_TENANT_ID).all()
    assert all(i.site_id == default["id"] for i in inquiries), "旧询盘应回填到默认站点"

    links = db_session.query(models.SiteProduct).filter(models.SiteProduct.site_id == default["id"]).count()
    assert links >= 4, "种子产品应关联到默认站点"


def test_default_site_cannot_be_deleted(seed_client):
    sites = seed_client.get("/api/sites").json()["sites"]
    default = next(s for s in sites if s["is_default"])
    assert seed_client.delete(f"/api/sites/{default['id']}").status_code == 400


# ---------------- 产品关联（复用事实） ----------------

def test_site_product_link_unlink(seed_client, db_session):
    """产品关联站点：关联/解除；产品本体不动（租户级单一事实）。

    用种子租户（有 4 个种子产品）验证新建站点的自动关联。
    """
    site = seed_client.post("/api/sites", json={"name": "产品关联站"}).json()["site"]
    # 新建站点时租户产品自动关联
    products = seed_client.get(f"/api/sites/{site['id']}/products").json()["products"]
    assert len(products) >= 1

    pid = products[0]["id"]
    # 解除关联
    assert seed_client.delete(f"/api/sites/{site['id']}/products/{pid}").status_code == 200
    after = seed_client.get(f"/api/sites/{site['id']}/products").json()["products"]
    assert all(p["id"] != pid for p in after)
    # 产品本体仍在（租户级）
    assert seed_client.get(f"/api/products/{pid}").status_code == 200
    # 重新关联（幂等）
    assert seed_client.post(f"/api/sites/{site['id']}/products", json={"product_id": pid}).status_code == 201
    assert seed_client.post(f"/api/sites/{site['id']}/products", json={"product_id": pid}).status_code == 201
    final = seed_client.get(f"/api/sites/{site['id']}/products").json()["products"]
    assert sum(1 for p in final if p["id"] == pid) == 1


# ---------------- 首次建站 / 免费额度 ----------------

def test_site_generate_creates_first_site(free_client):
    """隐式单站流程（Onboarding）：首次 /site/generate 同时落站点实体。"""
    res = free_client.post("/api/site/generate", json={"company": "首次建站公司", "industry": "水泵", "markets": ["en-US", "ru-RU"]})
    assert res.status_code == 200
    site_id = res.json().get("site_id")
    assert site_id, "首次生成必须返回创建的站点 id"

    sites = free_client.get("/api/sites").json()["sites"]
    assert any(s["id"] == site_id and s["name"] == "首次建站公司" for s in sites)
    # 该站点有自己的页面
    assert len(free_client.get(f"/api/pages?site_id={site_id}").json()) >= 6


def test_free_generation_is_account_level(free_client):
    """免费完整生成是账号级：用完 1 次后，新站点不能再免费生成。"""
    assert free_client.post("/api/site/generate", json={"company": "第一次", "markets": ["en-US"]}).status_code == 200
    usage = free_client.post("/api/usage/consume")
    assert usage.status_code == 200
    # 再来一次 → 402（不是每个站点一次）
    assert free_client.post("/api/usage/consume").status_code == 402
    second = free_client.post("/api/site/generate", json={"company": "第二次", "markets": ["en-US"]})
    # 生成本身仍可记录（门禁在 consume），但免费额度已耗尽由 usage 端点裁定
    assert second.status_code in (200, 402)


# ---------------- 站点作用域过滤 ----------------

def test_inquiries_versions_filter_by_site(client):
    site = client.post("/api/sites", json={"name": "过滤验证站"}).json()["site"]
    # 带错误归属的 site_id（别人的 id 格式）→ 404
    assert client.get("/api/inquiries?site_id=site_notexist").status_code == 404
    assert client.get(f"/api/drafts?site_id=site_notexist").status_code == 404
    assert client.get(f"/api/versions/recent?site_id=site_notexist").status_code == 404
    # 自己的站点 → 200（空数据也是 200）
    assert client.get(f"/api/inquiries?site_id={site['id']}").status_code == 200
    assert client.get(f"/api/drafts?site_id={site['id']}").status_code == 200
    assert client.get(f"/api/versions/recent?site_id={site['id']}").status_code == 200


def test_health_reports_site_count(client):
    """通用概览的数据来源：/api/health 返回站点数。"""
    before = client.get("/api/health").json()["sites"]
    client.post("/api/sites", json={"name": "计数站"})
    after = client.get("/api/health").json()["sites"]
    assert after == before + 1
