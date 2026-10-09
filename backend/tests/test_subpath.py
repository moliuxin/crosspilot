"""部署子路径支持（SITEPILOT_APP_BASE_PATH / SITEPILOT_API_BASE_PATH）。

验证：
  1. APP_BASE_PATH=/crosspilot 时全部 API 挂载到 /crosspilot/api，旧根前缀消失
  2. 路径规范化：无前导斜杠 / 尾斜杠 / 重复斜杠均等价
  3. docs / openapi / 应用 meta 跟随前缀；/healthz 保持前缀无关
  4. 默认配置保持 /api 前缀（根路径部署兼容）
"""
import importlib

import pytest
from fastapi.testclient import TestClient

import app.main as app_main
from app.config import get_settings, normalize_base_path
from app.database import get_db


@pytest.fixture()
def subpath_client(monkeypatch, db_session):
    """把应用重载到 /crosspilot 子路径（顺便用未规范化的值测试 normalize）。"""
    monkeypatch.setenv("SITEPILOT_APP_BASE_PATH", "crosspilot//")
    get_settings.cache_clear()
    mod = importlib.reload(app_main)

    def _override_session():
        try:
            yield db_session
        finally:
            pass

    mod.app.dependency_overrides[get_db] = _override_session
    with TestClient(mod.app) as client:
        yield client
    mod.app.dependency_overrides.clear()
    monkeypatch.delenv("SITEPILOT_APP_BASE_PATH")
    get_settings.cache_clear()
    importlib.reload(app_main)


def test_normalize_base_path():
    assert normalize_base_path("") == "/"
    assert normalize_base_path("/") == "/"
    assert normalize_base_path("crosspilot") == "/crosspilot"
    assert normalize_base_path("/crosspilot/") == "/crosspilot"
    assert normalize_base_path("///a//b///") == "/a/b"


def test_api_mounted_under_custom_prefix(subpath_client):
    # 业务端点跟随新前缀（health 需要登录：401 = 路由存在且鉴权生效）
    r = subpath_client.get("/crosspilot/api/health")
    assert r.status_code == 401
    # 旧根前缀不再挂载（防止双前缀并存导致前缀泄漏）
    assert subpath_client.get("/api/health").status_code == 404
    # openapi / docs / meta 跟随前缀
    assert subpath_client.get("/crosspilot/api/openapi.json").status_code == 200
    assert subpath_client.get("/crosspilot/api/docs").status_code == 200
    assert subpath_client.get("/crosspilot").status_code == 200
    assert subpath_client.get("/crosspilot/").status_code in (200, 307)
    # 容器探针与前缀无关
    assert subpath_client.get("/healthz").status_code == 200
    # openapi 中的路径都带前缀
    assert "/crosspilot/api/auth/login" in subpath_client.get("/crosspilot/api/openapi.json").json()["paths"]


def test_register_login_under_custom_prefix(subpath_client):
    """子路径前缀下完整注册 → 登录 → 鉴权访问链路可用。"""
    reg = subpath_client.post(
        "/crosspilot/api/auth/register",
        json={
            "email": "subpath@example.com",
            "password": "sub-pass-123",
            "display_name": "子路径租户",
            "company_name": "子路径公司",
        },
    )
    assert reg.status_code in (200, 201), reg.text
    token = reg.json()["token"]
    me = subpath_client.get(
        "/crosspilot/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "subpath@example.com"


def test_default_prefix_unchanged():
    """默认（无配置）保持 /api —— 根路径部署与既有调用方完全兼容。"""
    s = get_settings()
    assert s.api_prefix == "/api"
    assert s.app_base == "/"


def test_api_base_path_override(db_session, monkeypatch):
    """SITEPILOT_API_BASE_PATH 可独立于应用子路径指定 API 前缀。"""
    monkeypatch.setenv("SITEPILOT_API_BASE_PATH", "/backend-api")
    get_settings.cache_clear()
    try:
        s = get_settings()
        assert s.api_prefix == "/backend-api"
    finally:
        monkeypatch.delenv("SITEPILOT_API_BASE_PATH")
        get_settings.cache_clear()
