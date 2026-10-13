# -*- coding: utf-8 -*-
"""P0-IMAGE-RATE-LIMIT-RESILIENCE E2E。

覆盖:
- 队列:429 一次 → Retry-After 严格等待 → 重试成功(AI_GENERATED,不 fallback)
- 持续 429 → 重试上限 → FALLBACK(reason=rate limited)→ Provider 恢复后
  POST /visuals/regenerate 只补 FALLBACK → 全部恢复 AI
- 共享:product_cover 三市场只生成 1 次;总图片 API 调用 ≤ 7
- Case:AI 永不生成"真实客户案例"图 → AI_GENERATED_CONCEPT 概念展示
- 状态:GET /visuals/status 报告真实进度与失败原因
"""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.services import image_queue, market_variants


# ---------------- Fake providers ----------------

class RateLimitError(Exception):
    """模拟 GLM 图像 API 429(带 Retry-After 响应头,供队列严格等待)。"""

    def __init__(self, retry_after: float | None = None):
        self.retry_after = retry_after
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        resp = httpx.Response(429, headers=headers, request=httpx.Request("POST", "http://t"))
        super().__init__(f"429 Too Many Requests (retry-after={retry_after})")
        self.response = resp


class CountingProvider:
    """恒成功 + 记录调用(market, role)。"""

    name = "counting"

    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    async def generate(self, prompt, *, market, role, subject):
        self.calls.append((market, role))
        return {"url": f"data:image/svg+xml;base64,{market}-{role}-{len(self.calls)}",
                "provider": self.name, "source_type": "AI_GENERATED"}


class Flaky429Provider(CountingProvider):
    """前 N 次调用抛 429(带 Retry-After),之后恢复。"""

    def __init__(self, fail_first: int, retry_after: float | None = None):
        super().__init__()
        self.fail_first = fail_first
        self.retry_after = retry_after

    async def generate(self, prompt, *, market, role, subject):
        if len(self.calls) < self.fail_first:
            self.calls.append((market, role))
            raise RateLimitError(retry_after=self.retry_after)
        return await super().generate(prompt, market=market, role=role, subject=subject)


class Always429Provider(Flaky429Provider):
    def __init__(self):
        super().__init__(fail_first=10 ** 9)


# ---------------- fixtures ----------------

@pytest.fixture(autouse=True)
def _fast_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "image_request_interval_ms", 0)
    monkeypatch.setattr(s, "image_retry_base_seconds", 0.02)
    market_variants.reset_image_jobs()
    image_queue.clear_cache()
    yield


def _auth(client, email):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "限流测试公司", "industry": "协作机器人",
    })
    assert r.status_code == 201, r.text
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return c


def _install_provider(monkeypatch, provider):
    import app.image_provider as ip_mod
    monkeypatch.setattr(ip_mod, "get_image_provider", lambda: provider)
    return provider


def _make_site(c, markets=("zh-CN", "en-US", "ru-RU"), email_suffix="x"):
    r = c.post("/api/sites/generate", json={
        "company_name": f"Robotics Factory {email_suffix}",
        "product_category": "六轴协作机器人",
        "target_markets": list(markets),
    })
    assert r.status_code == 201, r.text
    return r.json()["site"]["id"]


# ---------------- 队列单元:429 → Retry-After → 重试成功 ----------------

def test_queue_retry_after_then_success(monkeypatch):
    provider = Flaky429Provider(fail_first=1, retry_after=0.03)
    res = asyncio.run(image_queue.generate_with_retry(
        provider, "prompt", market="en-US", role="hero"))
    assert res["url"], res
    assert res["status"] == "success"
    assert res["attempts"] == 2
    assert res["retries"] == 1
    assert res["rate_limit_hit"] is True
    assert len(provider.calls) == 2


def test_queue_sustained_429_falls_back(monkeypatch):
    provider = Always429Provider()
    res = asyncio.run(image_queue.generate_with_retry(
        provider, "prompt", market="ru-RU", role="hero"))
    assert res["url"] == ""
    assert res["status"] == "failed"
    assert res["error_code"] == "429"
    assert res["rate_limit_hit"] is True
    # 1 次首发 + 3 次重试(默认 max_retries=3) = 4 次调用,不立即放弃
    assert len(provider.calls) == get_settings().image_max_retries + 1


def test_queue_non_429_fails_fast(monkeypatch):
    class Boom(CountingProvider):
        async def generate(self, prompt, *, market, role, subject):
            self.calls.append((market, role))
            raise RuntimeError("boom")
    provider = Boom()
    res = asyncio.run(image_queue.generate_with_retry(
        provider, "prompt", market="zh-CN", role="hero"))
    assert res["status"] == "failed" and res["error_code"] == "RuntimeError"
    assert res["rate_limit_hit"] is False
    assert len(provider.calls) == 1  # 非 429 不重试


# ---------------- E2E:共享 cover + 预算 ≤ 7 ----------------

def _wipe_visual_cache(db_session, site_id: str):
    """清掉该站点的 DB 资产缓存,让下一次生成真正调用图片 API。"""
    from app import models
    db_session.query(models.Asset).filter(models.Asset.site_id == site_id).delete()
    db_session.commit()
    image_queue.clear_cache()
    market_variants.reset_image_jobs()


def test_shared_cover_and_budget(client, db_session, monkeypatch):
    c = _auth(client, "rl-budget@test.co")
    provider = _install_provider(monkeypatch, CountingProvider())
    site_id = _make_site(c, email_suffix="budget")
    _wipe_visual_cache(db_session, site_id)
    provider.calls.clear()

    r = c.post(f"/api/sites/{site_id}/market-variants/generate")
    assert r.status_code == 201, r.text

    # product_cover 跨市场共享:恰好 1 次真实调用
    cover_calls = [x for x in provider.calls if x[1] == "product_cover"]
    assert len(cover_calls) == 1, provider.calls
    # 总调用预算:cover×1 + hero×3 + application_scene×3 ≤ 7
    assert len(provider.calls) <= 7, provider.calls

    # 三市场 hero(及存在的 application_scene)全部 AI_GENERATED
    variants = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"]
    assert {v["market"] for v in variants} == {"zh-CN", "en-US", "ru-RU"}
    for v in variants:
        m = v["asset_manifest"]
        assert m["hero"]["source_type"] == "AI_GENERATED", (v["market"], m["hero"])
        assert m["product_cover"]["source_type"] == "AI_GENERATED", (v["market"], m["product_cover"])
        if "application_scene" in m:
            assert m["application_scene"]["source_type"] == "AI_GENERATED", (v["market"], m["application_scene"])
        # attempts/来源元数据完整(规格第十条)
        hero = m["hero"]
        assert "attempts" in hero and "provider" in hero and hero.get("status") == "success"


# ---------------- E2E:持续 429 → FALLBACK → regenerate 恢复 ----------------

def test_sustained_429_then_regenerate_recovers(client, monkeypatch):
    c = _auth(client, "rl-recover@test.co")
    bad = _install_provider(monkeypatch, Always429Provider())
    site_id = _make_site(c, email_suffix="recover")

    r = c.post(f"/api/sites/{site_id}/market-variants/generate")
    assert r.status_code == 201
    assert bad.calls  # 队列确实尝试过

    # 全部 FALLBACK,状态端点如实报告 Provider Rate Limited
    status = c.get(f"/api/sites/{site_id}/visuals/status").json()
    assert status["ok"] and status["job"]["status"] == "done"
    assert status["job"]["failed"] > 0
    for mrow in status["markets"]:
        assert mrow["FALLBACK"] > 0, mrow
        assert any("Rate Limited" in x for x in mrow["reasons"]), mrow

    # Provider 恢复 → regenerate(只补 FALLBACK,不重生成已成功的)
    good = _install_provider(monkeypatch, CountingProvider())
    r = c.post(f"/api/sites/{site_id}/visuals/regenerate", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["regenerated"] > 0 and body["still_fallback"] == 0, body

    variants = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"]
    for v in variants:
        for slot, info in v["asset_manifest"].items():
            assert info["source_type"] in ("AI_GENERATED", "AI_GENERATED_CONCEPT"), \
                (v["market"], slot, info)
        # section props 已回写图片
        hero = next(s for s in v["layout_schema"]["sections"] if s["type"] == "hero")
        assert hero["props"].get("image"), v["market"]
    # 状态端点现在全部干净
    status2 = c.get(f"/api/sites/{site_id}/visuals/status").json()
    for mrow in status2["markets"]:
        assert mrow["FALLBACK"] == 0 and mrow["AI"] >= 2, mrow


# ---------------- E2E:Case 概念化,永不伪装真实案例 ----------------

def test_case_never_ai_generated_as_customer_case(client, monkeypatch):
    c = _auth(client, "rl-case@test.co")
    provider = _install_provider(monkeypatch, CountingProvider())
    site_id = _make_site(c, email_suffix="case")

    r = c.post(f"/api/sites/{site_id}/market-variants/generate")
    assert r.status_code == 201

    # case 槽位零 AI 调用
    assert all(role != "case" for _, role in provider.calls), provider.calls

    labels = {"zh-CN": "应用场景概念展示", "en-US": "Application Concepts", "ru-RU": "Концепция применения"}
    variants = c.get(f"/api/sites/{site_id}/market-variants").json()["variants"]
    for v in variants:
        m = v["asset_manifest"]
        # 无案例区块的市场(case 区块未入选布局)允许没有 case 槽位
        if "case" in m:
            assert m["case"]["source_type"] == "AI_GENERATED_CONCEPT", (v["market"], m["case"])
        # cases 区块被概念化:标题本地化 + 明确标注,不再叫 Customer Case
        cases = [s for s in v["layout_schema"]["sections"] if s["type"] == "cases"]
        for s in cases:
            assert s["props"]["title"] == labels[v["market"]], (v["market"], s["props"])
            assert s["props"]["concept"] is True
            assert s["props"]["image_source"] == "AI_GENERATED_CONCEPT"


# ---------------- E2E:缓存复用(重新生成不再调 API) ----------------

def test_repeated_generation_uses_cache(client, db_session, monkeypatch):
    c = _auth(client, "rl-cache@test.co")
    provider = _install_provider(monkeypatch, CountingProvider())
    site_id = _make_site(c, email_suffix="cache")
    _wipe_visual_cache(db_session, site_id)
    provider.calls.clear()

    r1 = c.post(f"/api/sites/{site_id}/market-variants/generate")
    first = len(provider.calls)
    assert 0 < first <= 7, provider.calls

    provider.calls.clear()
    r2 = c.post(f"/api/sites/{site_id}/market-variants/generate")
    assert r2.status_code == 201
    # 结构相同 + DB 资产命中 → 零新增图片 API 调用
    assert provider.calls == [], provider.calls


# ---------------- 状态端点:PENDING 阶段可见(异步 UX 契约) ----------------

def test_status_endpoint_reports_market_counts(client, monkeypatch):
    c = _auth(client, "rl-status@test.co")
    _install_provider(monkeypatch, CountingProvider())
    site_id = _make_site(c, email_suffix="status")

    r = c.get(f"/api/sites/{site_id}/visuals/status")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["site_id"] == site_id
    assert body["job"]["status"] == "done"
    assert len(body["markets"]) == 3
    for mrow in body["markets"]:
        assert mrow["AI"] >= 2, mrow  # hero + application_scene
        # case 区块入选布局的市场才有概念槽位
        if mrow["market"] == "zh-CN":
            assert mrow["CONCEPT"] == 1, mrow  # case 概念展示
        assert mrow["PENDING"] == 0, mrow
