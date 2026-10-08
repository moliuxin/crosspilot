"""pytest 夹具：每个测试用独立的内存 SQLite，互不污染。

多租户改造后，业务端点全部要求登录；付费权限体系落地后，付费能力又要求
套餐支持。为了让历史用例继续表达「业务行为」本身，这里统一提供：

- ``client``：**已登录 + 已升级 Growth 套餐**的客户端（默认租户 owner）。
  历史用例几乎都在验证 SEO/发布/Agent 等付费能力的行为，所以要给足权限，
  否则 20+ 个用例会集体撞 402 —— 那测的是权限而不是行为。
- ``free_client``：已登录但**停留在 free 套餐**，专门用于断言付费门禁（402）。
- ``anon_client``：**未登录**的客户端，用于断言 401 鉴权边界。
- ``second_client``：第二个租户的已登录客户端，用于跨租户隔离断言。
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# 保证 `import app.*` 可用
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import entitlements, models  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402

PRIMARY_EMAIL = "owner@aquaflow-demo.com"
PRIMARY_PASSWORD = "test-pass-123"
SECOND_EMAIL = "rival@aquaflow-demo.com"
SECOND_PASSWORD = "rival-pass-123"


@pytest.fixture()
def db_session():
    """内存数据库会话（每测试一份）。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    seed_if_empty(session)
    # 历史 seed 未写 tenant_id，统一归属默认租户，模拟线上迁移后的状态
    for model in (models.Product, models.Inquiry, models.Page, models.TaskItem):
        for row in session.query(model).all():
            if getattr(row, "tenant_id", None) is None:
                row.tenant_id = models.DEFAULT_TENANT_ID
    # 生产环境由 _migrate_sqlite 建默认租户；测试库需自行补齐，
    # 否则站点的 SiteState(id=1) 会悬空、public_slug 无从谈起。
    if session.get(models.Tenant, models.DEFAULT_TENANT_ID) is None:
        session.add(
            models.Tenant(
                id=models.DEFAULT_TENANT_ID,
                name="AQUAFLOW Industrial",
                industry="工业水处理设备",
                plan="free",
                public_slug="t-1-seed01",
            )
        )
    entitlements.ensure_subscription(session, models.DEFAULT_TENANT_ID, plan_id="free")
    session.commit()
    try:
        yield session
    finally:
        session.close()


def _install_db_override(session):
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db


def _set_plan(session, tenant_id, plan_id):
    """直接改写订阅（权限真源），等价于平台审批通过。"""
    sub = entitlements.ensure_subscription(session, tenant_id, plan_id=plan_id)
    sub.plan_id = plan_id
    sub.status = "active"
    tenant = session.get(models.Tenant, tenant_id)
    if tenant:
        tenant.plan = plan_id
    session.commit()


@pytest.fixture()
def anon_client(db_session):
    """未登录客户端：用于鉴权边界断言（业务端点预期 401）。"""
    _install_db_override(db_session)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def owner_auth(db_session):
    """注册主租户并返回 (client, headers, tenant_id)。套餐为 free。"""
    _install_db_override(db_session)
    with TestClient(app) as c:
        reg = c.post(
            "/api/auth/register",
            json={
                "email": PRIMARY_EMAIL,
                "password": PRIMARY_PASSWORD,
                "display_name": "主租户",
                "company_name": "主租户公司",
            },
        )
        assert reg.status_code in (200, 201), reg.text
        body = reg.json()
        headers = {"Authorization": f"Bearer {body['token']}"}
        yield c, headers, body["user"]["tenantId"]
    app.dependency_overrides.clear()


@pytest.fixture()
def client(owner_auth, db_session):
    """**默认已登录 + Growth 套餐**的客户端 —— 历史用例直接复用。"""
    c, headers, tenant_id = owner_auth
    _set_plan(db_session, tenant_id, "growth")
    c.headers.update(headers)
    yield c


@pytest.fixture()
def free_client(owner_auth):
    """已登录但停留在 free 套餐：用于断言付费门禁 402。"""
    c, headers, _ = owner_auth
    c.headers.update(headers)
    yield c


SEED_EMAIL = "seed-owner@aquaflow-demo.com"
SEED_PASSWORD = "seed-pass-123"


@pytest.fixture()
def seed_client(db_session):
    """**默认租户（种子数据所在）+ Growth 套餐**的客户端。

    ``test_seo`` / ``test_publish_versions`` 等历史用例断言的是 prod_002 等
    种子产品的行为，那些数据属于默认租户。多租户改造后新注册的租户看不到
    它们（这正是隔离生效的证明），所以这些用例应绑定默认租户。
    """
    _install_db_override(db_session)
    _set_plan(db_session, models.DEFAULT_TENANT_ID, "growth")
    if db_session.query(models.User).filter(models.User.email == SEED_EMAIL).first() is None:
        from app.security import hash_password

        db_session.add(
            models.User(
                email=SEED_EMAIL,
                password_hash=hash_password(SEED_PASSWORD),
                display_name="种子租户",
                role="owner",
                tenant_id=models.DEFAULT_TENANT_ID,
            )
        )
        db_session.commit()
    with TestClient(app) as c:
        reg = c.post(
            "/api/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
        )
        assert reg.status_code == 200, reg.text
        c.headers.update({"Authorization": f"Bearer {reg.json()['token']}"})
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(owner_auth):
    return owner_auth[1]


@pytest.fixture()
def primary_tenant_id(owner_auth):
    return owner_auth[2]


@pytest.fixture()
def second_client(owner_auth):
    """第二个租户的已登录客户端，用于跨租户隔离断言。"""
    c, _, _ = owner_auth
    reg = c.post(
        "/api/auth/register",
        json={
            "email": SECOND_EMAIL,
            "password": SECOND_PASSWORD,
            "display_name": "竞争租户",
            "company_name": "竞争租户公司",
        },
    )
    assert reg.status_code in (200, 201), reg.text
    headers = {"Authorization": f"Bearer {reg.json()['token']}"}
    with TestClient(app) as c2:
        c2.headers.update(headers)
        yield c2
