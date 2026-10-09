"""LLM adapter 抽象层。

设计意图：把「AI 能力」与「调用哪个模型」解耦。
- 默认 ``mock``：无外部依赖，返回结构稳定、内容专业化的模板结果，供校赛演示与测试使用。
- 设为 ``openai`` 并配置 ``SITEPILOT_LLM_API_KEY``：走 OpenAI 兼容协议
  （OpenAI / DeepSeek / 通义 / 本地 vLLM 均可，只需改 base_url 与 model）。

所有方法签名与返回结构在两种 provider 下完全一致，上层 service 无需改动。
真实调用失败时自动降级到 mock，保证演示不中断（并在返回值中标注 degraded）。
"""
from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    """模型提供方接口。"""

    name: str = "base"

    @abstractmethod
    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        """返回结构化 JSON。"""

    def health(self) -> dict[str, Any]:
        return {"provider": self.name, "enabled": False}


class MockProvider(LLMProvider):
    """无外部依赖的确定性实现（校赛 / 测试默认）。"""

    name = "mock"

    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        return {"_mock": True}

    def health(self) -> dict[str, Any]:
        return {"provider": "mock", "enabled": False, "note": "未配置真实模型，使用内置模板生成"}


class OpenAICompatProvider(LLMProvider):
    """OpenAI 兼容协议的通用实现（OpenAI / DeepSeek / 通义 / vLLM…）。"""

    name = "openai"

    def __init__(self, api_key: str, base_url: str, model: str, timeout: float = 60.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        import httpx  # 延迟导入，未使用真实 provider 时不需要

        self._client = httpx.AsyncClient(timeout=timeout)

    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.6,
            "response_format": {"type": "json_object"},
        }
        resp = await self._client.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)

    def health(self) -> dict[str, Any]:
        return {"provider": "openai", "enabled": True, "model": self.model, "base_url": self.base_url}


_provider: LLMProvider | None = None

# 运行时调用状态（进程内，非持久化）：真实 provider 配置了但调用失败 = degraded
_status: dict[str, Any] = {
    "degraded": False,
    "last_error": "",
    "last_latency_ms": 0,
    "calls_total": 0,
    "calls_ok": 0,
    "calls_failed": 0,
}


def get_provider() -> LLMProvider:
    """按配置返回 provider（单例）。"""
    global _provider
    if _provider is not None:
        return _provider

    s = get_settings()
    if s.llm_enabled:
        try:
            _provider = OpenAICompatProvider(s.llm_api_key, s.llm_base_url, s.llm_model, s.llm_timeout)
            logger.info("LLM provider = %s (%s)", s.llm_provider, s.llm_model)
            return _provider
        except Exception as exc:  # pragma: no cover - 依赖缺失等环境问题
            logger.warning("初始化真实 LLM provider 失败，降级 mock：%s", exc)

    _provider = MockProvider()
    return _provider


class AIRealUnavailableError(RuntimeError):
    """DEMO_REQUIRE_REAL_AI=true 且真实模型不可用/调用失败时抛出（不静默降级）。"""

    def __init__(self, reason: str):
        super().__init__(f"真实AI服务暂时不可用，请检查模型连接。原因：{reason}")
        self.reason = reason


# 每次调用的执行记录（capability 级），由调用方落库为 AIExecution
import time
from collections import deque

_executions: deque[dict[str, Any]] = deque(maxlen=256)


def _record(capability: str, source: str, latency_ms: int, success: bool, error: str = "") -> None:
    _executions.append(
        {
            "capability": capability or "unknown",
            "provider": get_provider().name,
            "model": _model_name(),
            "source": source,  # glm | template_fallback | template
            "latency_ms": latency_ms,
            "success": success,
            "error": error[:500],
        }
    )


def _model_name() -> str:
    provider = get_provider()
    return getattr(provider, "model", "") or provider.name


def drain_executions() -> list[dict[str, Any]]:
    """取走自上次以来的执行记录（供路由层写入 AIExecution 表）。"""
    out = list(_executions)
    _executions.clear()
    return out


async def complete_json(
    system: str,
    user: str,
    capability: str = "",
    schema_keys: list[str] | None = None,
) -> dict[str, Any] | None:
    """安全调用：失败返回 None，由调用方决定降级策略。

    - ``capability``：能力标识（industry/persona/site_planner/...），落 AIExecution 用
    - ``schema_keys``：返回 JSON 必须包含的顶层键；不符合时自动重试一次，仍失败按失败处理
    - 成功结果会注入 ``_ai_source``（"glm"）与 ``_ai_model`` 供上层透传到前端
    - DEMO_REQUIRE_REAL_AI=true：未配置真实模型或调用失败时抛 AIRealUnavailableError，不降级
    """
    s = get_settings()
    provider = get_provider()
    if isinstance(provider, MockProvider):
        # 未配置真实模型：模板链路由上层 service 完成，这里如实标注
        _record(capability, "template", 0, True, "unconfigured: mock provider")
        if s.demo_require_real_ai:
            raise AIRealUnavailableError("未配置真实 LLM（SITEPILOT_LLM_PROVIDER/API_KEY）")
        return None

    _status["calls_total"] += 1
    started = time.perf_counter()
    last_error = ""
    for attempt in (1, 2):  # schema 校验失败自动重试一次
        try:
            result = await provider.complete_json(system, user)
            if schema_keys and not all(k in result for k in schema_keys):
                missing = [k for k in schema_keys if k not in result]
                last_error = f"schema 校验失败(第{attempt}次)，缺失字段：{','.join(missing)}"
                logger.warning("LLM %s %s", capability or "-", last_error)
                continue
            latency_ms = int((time.perf_counter() - started) * 1000)
            _status["calls_ok"] += 1
            _status["last_error"] = ""
            _status["degraded"] = False
            _status["last_latency_ms"] = latency_ms
            result["_ai_source"] = "glm"
            result["_ai_model"] = provider.model
            _record(capability, "glm", latency_ms, True)
            return result
        except Exception as exc:  # 网络/配额等
            last_error = (str(exc).strip() or type(exc).__name__)[:200]
            continue

    latency_ms = int((time.perf_counter() - started) * 1000)
    _status["calls_failed"] += 1
    _status["last_error"] = last_error
    _status["degraded"] = True
    _status["last_latency_ms"] = latency_ms
    logger.warning("LLM 调用失败，降级模板结果：%s", last_error)
    _record(capability, "template_fallback", latency_ms, False, last_error)
    if s.demo_require_real_ai:
        raise AIRealUnavailableError(last_error)
    return None


# 运行时调用状态（进程内，非持久化）：真实 provider 配置了但调用失败 = degraded
def status() -> dict[str, Any]:
    """AI 能力运行状态：provider 配置 + 真实调用成败（供 /api/health 与 /api/ai/status）。
    绝不包含 API Key。"""
    provider = get_provider()
    base = provider.health()
    base.pop("api_key", None)
    base.update(
        degraded=_status["degraded"],
        last_error=_status["last_error"],
        last_latency_ms=_status.get("last_latency_ms", 0),
        calls_total=_status["calls_total"],
        calls_ok=_status["calls_ok"],
        calls_failed=_status["calls_failed"],
        runtime="real-llm" if base.get("enabled") and not _status["degraded"] else (
            "degraded" if base.get("enabled") else "template-fallback"
        ),
    )
    return base


def reset_runtime_status() -> None:
    """测试辅助：清零运行时状态与 provider 单例。"""
    global _provider
    _provider = None
    _status.update(degraded=False, last_error="", calls_total=0, calls_ok=0, calls_failed=0, last_latency_ms=0)
    _executions.clear()
