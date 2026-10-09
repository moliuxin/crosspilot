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


async def complete_json(system: str, user: str) -> dict[str, Any] | None:
    """安全调用：失败返回 None，由调用方决定降级策略。

    每次真实调用（成功或失败）都会更新运行时状态，供 /api/health 暴露
    degraded 标记 —— 前端据此显示「AI: real」或「AI: degraded」。
    """
    provider = get_provider()
    if isinstance(provider, MockProvider):
        return None
    _status["calls_total"] += 1
    try:
        result = await provider.complete_json(system, user)
        _status["calls_ok"] += 1
        _status["last_error"] = ""
        _status["degraded"] = False
        return result
    except Exception as exc:  # pragma: no cover - 网络/配额等
        _status["calls_failed"] += 1
        # 部分网络异常（如 Windows 下的 ConnectTimeout）str 为空，回退到类型名，避免健康面板显示空白错误
        _status["last_error"] = (str(exc).strip() or type(exc).__name__)[:200]
        _status["degraded"] = True
        logger.warning("LLM 调用失败，降级模板结果：%s", _status["last_error"])
        return None


# 运行时调用状态（进程内，非持久化）：真实 provider 配置了但调用失败 = degraded
def status() -> dict[str, Any]:
    """AI 能力运行状态：provider 配置 + 真实调用成败（供 /api/health）。"""
    provider = get_provider()
    base = provider.health()
    base.update(
        degraded=_status["degraded"],
        last_error=_status["last_error"],
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
    _status.update(degraded=False, last_error="", calls_total=0, calls_ok=0, calls_failed=0)
