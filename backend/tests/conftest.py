"""pytest 夹具：每个测试使用独立数据库状态，统一跑在 PostgreSQL 上。

测试库必须显式提供（默认连接 docker-compose.test.yml 的 55432），
避免误连开发/生产数据库。

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
from sqlalchemy import text

# 保证 `import app.*` 可用（必须在导入 app 之前设置数据库环境）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DATABASE_URL = os.environ.get(
    "SITEPILOT_TEST_DATABASE_URL",
    "postgresql+psycopg://crosspilot:crosspilot@127.0.0.1:55432/crosspilot_test",
)
os.environ["SITEPILOT_DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SITEPILOT_AUTO_INIT"] = "false"

from app import entitlements, models  # noqa: E402
from app.database import Base, SessionLocal, engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402

PRIMARY_EMAIL = "owner@aquaflow-demo.com"
PRIMARY_PASSWORD = "test-pass-123"
SECOND_EMAIL = "rival@aquaflow-demo.com"
SECOND_PASSWORD = "rival-pass-123"


@pytest.fixture(scope="session", autouse=True)
def _prepare_test_database():
    """会话级建表；每个测试通过 TRUNCATE 隔离状态。"""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session(_prepare_test_database):
    """PostgreSQL 会话（每测试一份干净数据）。

    直接 TRUNCATE 所有表而不是每测重建 schema：性能更稳定，也能覆盖
    应用中直接使用 SessionLocal 的路径。
    """
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))

    session = SessionLocal()
    seed_if_empty(session, include_demo_account=False)
    # 测试以 free 为基线；需要付费能力的用例通过 _set_plan 显式升级
    sub = entitlements.ensure_subscription(session, models.DEFAULT_TENANT_ID, plan_id="free")
    sub.plan_id = "free"
    sub.status = "active"
    tenant = session.get(models.Tenant, models.DEFAULT_TENANT_ID)
    if tenant is not None:
        tenant.plan = "free"
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
