"""P0-1 真实 LLM 链路测试。

用本地 fake OpenAI-compatible server（backend/tools/fake_llm_server.py 的应用对象）
验证：
  1. 配置 openai provider 后 /api/health 显示 provider=openai & enabled=true
  2. 页面 AI 改写走真实协议链路（source=llm，fake server 确实收到请求）
  3. LLM 不可用时自动降级（source=template）且 /api/health 标记 degraded=true
"""
from __future__ import annotations

import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app import llm
from app.config import get_settings
from tools.fake_llm_server import app as fake_app, CALLS


@pytest.fixture()
def fake_llm():
    """进程内起 fake OpenAI-compatible server（真实 HTTP，非 mock client）。"""
    config = uvicorn.Config(fake_app, host="127.0.0.1", port=8199, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # 等端口就绪
    for _ in range(50):
        try:
            import httpx

            httpx.get("http://127.0.0.1:8199/health", timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)
    yield "http://127.0.0.1:8199/v1"
    server.should_exit = True
    thread.join(timeout=3)


@pytest.fixture()
def openai_env(fake_llm, monkeypatch):
    """把后端切到 openai provider（指向 fake server），并重置单例与运行时状态。"""
    monkeypatch.setenv("SITEPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setenv("SITEPILOT_LLM_API_KEY", "test-key-123")
    monkeypatch.setenv("SITEPILOT_LLM_BASE_URL", fake_llm)
    monkeypatch.setenv("SITEPILOT_LLM_MODEL", "fake-gpt-test")
    monkeypatch.setenv("SITEPILOT_LLM_TIMEOUT", "10")
    get_settings.cache_clear()
    llm.reset_runtime_status()
    CALLS.clear()
    yield
    get_settings.cache_clear()
    llm.reset_runtime_status()


def test_health_reports_openai_provider(client, openai_env):
    """配置真实 provider 后 health 显示 provider=openai、enabled=true。"""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    ai = resp.json()["ai"]
    assert ai["provider"] == "openai"
    assert ai["enabled"] is True
    assert ai["model"] == "fake-gpt-test"
    assert ai["degraded"] is False
    assert ai["runtime"] == "real-llm"


def test_ai_rewrite_uses_real_llm(client, openai_env):
    """页面 AI 改写走真实 LLM：返回 ai_source=llm，fake server 收到带鉴权的请求。"""
    page_id = db_session_page(client)
    page = client.get(f"/api/pages/{page_id}").json()
    section_id = (page.get("sections") or [{}])[0].get("id", "")

    before_calls = len(CALLS)
    resp = client.post(
        f"/api/pages/{page_id}/ai-rewrite",
        json={"section_id": section_id, "field": "title",
              "instruction": "突出 24 小时报价", "market": "en-US"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_source"] == "llm", f"应来自真实 LLM，实际 {body}"
    assert "LLM rewritten" in body["after"]
    assert len(CALLS) == before_calls + 1
    assert CALLS[-1]["model"] == "fake-gpt-test"

    # 调用后 health 的运行时状态更新：real-llm + 计数
    ai = client.get("/api/health").json()["ai"]
    assert ai["calls_total"] >= 1 and ai["calls_ok"] >= 1
    assert ai["runtime"] == "real-llm"

    # DB 变化：采纳建议（前端确认后保存的真实路径）→ 改写结果落库
    sections = page["sections"]
    sections[0]["props"]["title"] = body["after"]
    put = client.put(f"/api/pages/{page_id}", json={"sections": sections})
    assert put.status_code == 200
    stored = client.get(f"/api/pages/{page_id}").json()
    assert "LLM rewritten" in stored["sections"][0]["props"]["title"]


def test_llm_down_degrades_to_template(client, openai_env):
    """LLM 不可用：降级 template，且 health 标记 degraded=true（不自欺为正常）。"""
    import httpx

    # 把 provider 指到不存在的端口，模拟 LLM 服务宕机
    llm.reset_runtime_status()
    provider = llm.get_provider()
    provider.base_url = "http://127.0.0.1:9/v1"
    provider._client = httpx.AsyncClient(timeout=2.0)

    from app import models  # noqa: F401

    page_id = db_session_page(client)
    resp = client.post(
        f"/api/pages/{page_id}/ai-rewrite",
        json={"section_id": "", "field": "title", "instruction": "测试降级", "market": "en-US"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_source"] == "template"

    ai = client.get("/api/health").json()["ai"]
    assert ai["degraded"] is True
    assert ai["calls_failed"] >= 1
    assert ai["last_error"]
    assert ai["runtime"] == "degraded"


def db_session_page(client) -> str:
    """通过公开 API 拿一个 page id（避免依赖 db_session 夹具的会话）。"""
    resp = client.get("/api/pages")
    pages = resp.json()
    pages = pages if isinstance(pages, list) else pages.get("items", [])
    return pages[0]["id"]
