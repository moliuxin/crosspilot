"""ImageProvider 抽象层 —— GLM-Image 为默认实现（P0-AI-SITE-GENERATION）。

设计意图（与 llm.py 同构）：
- 把「图片能力」与「调用哪个图像模型」解耦；图像 API 不写死在页面组件；
- 默认 ``mock``：生成确定性 SVG 占位图（带行业/场景上下文文字），零外部依赖；
- 配置 ``SITEPILOT_IMAGE_API_KEY`` 后走 OpenAI 兼容图像协议
  （Z.AI GLM-Image / OpenAI Images 均可，改 base_url + model 即可切换）；
- 所有生成结果记录 Asset（source_type=AI_GENERATED / provider / prompt），
  失败返回安全 fallback，页面不空白。
"""
from __future__ import annotations

import base64
import logging
import urllib.parse
from abc import ABC, abstractmethod
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)

_FALLBACK_NOTE = "部分 AI 图片生成失败，可重新生成"


class ImageProvider(ABC):
    name = "base"

    @abstractmethod
    async def generate(self, prompt: str, *, market: str, role: str, subject: str) -> dict[str, Any]:
        """生成一张图。返回 {url, provider, source_type}；失败抛异常。"""

    def health(self) -> dict[str, Any]:
        return {"provider": self.name, "enabled": False}


def _svg_data_url(subject: str, scene: str, market: str) -> str:
    """Mock 占位图：可区分行业/市场的 SVG（data URL，无外部依赖）。"""
    label = f"{subject} · {market}"
    colors = {
        "zh-CN": ("#0f2a5f", "#2563eb"),
        "en-US": ("#082f49", "#06b6d4"),
        "ru-RU": ("#111827", "#dc2626"),
    }
    c1, c2 = colors.get(market, ("#0f2a5f", "#2563eb"))
    text = urllib.parse.quote(label)[:60]
    svg = (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540'>"
        f"<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
        f"<stop offset='0' stop-color='{c1}'/><stop offset='1' stop-color='{c2}'/>"
        f"</linearGradient></defs>"
        f"<rect width='960' height='540' fill='url(#g)'/>"
        f"<circle cx='780' cy='120' r='150' fill='rgba(255,255,255,0.08)'/>"
        f"<circle cx='160' cy='440' r='110' fill='rgba(255,255,255,0.06)'/>"
        f"<text x='48' y='270' font-family='Arial' font-size='34' fill='white' font-weight='700'>{text}</text>"
        f"<text x='48' y='312' font-family='Arial' font-size='18' fill='rgba(255,255,255,0.75)'>{scene[:52]}</text>"
        f"<text x='48' y='500' font-family='Arial' font-size='14' fill='rgba(255,255,255,0.55)'>AI-GENERATED · Mock Provider</text>"
        f"</svg>"
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode()


class MockImageProvider(ImageProvider):
    """确定性占位实现（无外部依赖；视觉按市场区分）。"""

    name = "mock"

    async def generate(self, prompt: str, *, market: str, role: str, subject: str) -> dict[str, Any]:
        return {
            "url": _svg_data_url(subject, prompt[:80], market),
            "provider": "mock",
            "source_type": "AI_GENERATED",
        }

    def health(self) -> dict[str, Any]:
        return {"provider": "mock", "enabled": False, "note": "未配置图像模型，使用结构化占位图"}


class GLMImageProvider(ImageProvider):
    """OpenAI 兼容图像协议实现（GLM-Image / OpenAI Images）。"""

    name = "glm-image"

    def __init__(self, api_key: str, base_url: str, model: str, timeout: float = 120.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        import httpx

        self._client = httpx.AsyncClient(timeout=timeout)

    async def generate(self, prompt: str, *, market: str, role: str, subject: str) -> dict[str, Any]:
        resp = await self._client.post(
            f"{self.base_url}/images/generations",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json={"model": self.model, "prompt": prompt, "n": 1, "size": "1024x576"},
        )
        resp.raise_for_status()
        data = resp.json()
        item = data["data"][0]
        url = item.get("url") or ("data:image/png;base64," + item["b64_json"] if item.get("b64_json") else "")
        if not url:
            raise ValueError("图像接口未返回 url/b64_json")
        return {"url": url, "provider": self.name, "source_type": "AI_GENERATED"}

    def health(self) -> dict[str, Any]:
        return {"provider": self.name, "enabled": True, "model": self.model, "base_url": self.base_url}


_provider: ImageProvider | None = None


def get_image_provider() -> ImageProvider:
    global _provider
    if _provider is not None:
        return _provider
    s = get_settings()
    if s.image_api_key:
        try:
            _provider = GLMImageProvider(s.image_api_key, s.image_base_url, s.image_model, s.image_timeout)
            logger.info("Image provider = glm-image (%s)", s.image_model)
            return _provider
        except Exception as exc:  # pragma: no cover
            logger.warning("初始化图像 provider 失败，降级 mock：%s", exc)
    _provider = MockImageProvider()
    return _provider


def image_health() -> dict[str, Any]:
    return get_image_provider().health()


def reset_image_provider() -> None:
    global _provider
    _provider = None
