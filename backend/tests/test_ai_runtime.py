# -*- coding: utf-8 -*-
"""P0-REAL-AI-RUNTIME：AI 状态端点 / ai_source 标注 / Demo 模式 / AIExecution 落库。"""
import pytest
from fastapi.testclient import TestClient

from app import llm
from app.config import get_settings


@pytest.fixture(autouse=True)
def _reset_llm():
    llm.reset_runtime_status()
    yield
    llm.reset_runtime_status()


def _auth_client(client):
    r = client.post("/api/auth/register", json={
        "email": "ai-rt@test.co", "password": "pass-123456",
        "company_name": "AI运行时测试", "industry": "工业水泵",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def test_ai_status_shape_no_key(client):
    """/api/ai/status 返回运行时字段且绝不包含 API Key。"""
    c = _auth_client(client)
    r = c.get("/api/ai/status")
    assert r.status_code == 200
    d = r.json()
    for k in ("provider", "runtime", "calls_total", "calls_ok", "calls_failed",
              "last_latency_ms", "executions"):
        assert k in d
    assert "api_key" not in d
    assert "key" not in str(d.get("provider", ""))


def test_generate_response_carries_ai_source(client):
    """sites/generate 响应必须带 ai_source（mock 环境下如实为 template）。"""
    c = _auth_client(client)
    r = c.post("/api/sites/generate", json={
        "company_name": "AI源测试厂", "product_category": "工业水泵",
        "target_markets": ["zh-CN", "en-US", "ru-RU"],
    })
    assert r.status_code == 201
    d = r.json()
    assert d["ai_source"] in ("glm", "template", "template_fallback")
    assert d["ai_model"]
    assert d["ai_note"]
    # mock 环境下必须如实标注为内置模板
    assert d["ai_source"] == "template"


def test_ai_executions_persisted(client):
    """生成一次后，capability 级 AIExecution 落库（无 API Key 字段）。"""
    c = _auth_client(client)
    c.post("/api/sites/generate", json={
        "company_name": "日志测试厂", "product_category": "LED 照明",
        "target_markets": ["en-US"],
    })
    r = c.get("/api/ai/status")
    d = r.json()
    assert d["execution_count"] >= 1
    caps = {e["capability"] for e in d["executions"]}
    assert caps & {"industry_analyzer", "buyer_persona", "market_localization",
                   "site_planner", "image_brief"}
    for e in d["executions"]:
        assert "key" not in e


@pytest.mark.asyncio
async def test_demo_require_real_ai_raises():
    """DEMO_REQUIRE_REAL_AI=true 且未配置真实模型 → 明确报错，不静默降级。"""
    import os
    os.environ["SITEPILOT_DEMO_REQUIRE_REAL_AI"] = "true"
    get_settings.cache_clear()
    llm.reset_runtime_status()
    try:
        with pytest.raises(llm.AIRealUnavailableError):
            await llm.complete_json("s", "u", capability="industry_analyzer")
    finally:
        os.environ.pop("SITEPILOT_DEMO_REQUIRE_REAL_AI", None)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_schema_retry_and_fallback(monkeypatch):
    """schema 校验失败自动重试一次，仍失败返回 None（模板降级）。"""
    calls = {"n": 0}

    class Flaky:
        name = "openai"
        model = "test-model"

        async def complete_json(self, system, user):
            calls["n"] += 1
            return {"unexpected": 1}  # 永远缺字段

    monkeypatch.setattr(llm, "get_provider", lambda: Flaky())
    result = await llm.complete_json("s", "u", capability="x", schema_keys=["required_field"])
    assert result is None  # 两次都缺字段 → 降级
    assert calls["n"] == 2  # 重试了一次
