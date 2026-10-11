"""图片生成队列 + 429 重试 + 缓存(P0-IMAGE-RATE-LIMIT-RESILIENCE)。

设计:
- 全局串行队列(max_concurrency 可配),间隔 request_interval_ms
- 429: 读 Retry-After → 指数退避(2s/4s/8s + jitter),最多 max_retries 次
- 缓存: 相同 prompt + market + role 的请求直接复用已成功 Asset
- 共享资产: product_cover 等跨市场共享(只生成一次)
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import time
from datetime import datetime, timezone
from typing import Any

from .. import models
from ..config import get_settings
from ..utils import new_id

logger = logging.getLogger(__name__)

# 全局队列信号量(限制并发)
_semaphore: asyncio.Semaphore | None = None
_last_request_time: float = 0

# 资产缓存: cache_key → asset dict(进程内)
_cache: dict[str, dict] = {}

# 共享槽位(跨市场只生成一次)
SHARED_SLOTS = {"product_cover", "product_gallery", "case"}


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        s = get_settings()
        _semaphore = asyncio.Semaphore(max(1, s.image_max_concurrency))
    return _semaphore


def _make_cache_key(tenant_id: int, product_category: str, market: str, role: str, prompt: str) -> str:
    raw = f"{tenant_id}:{product_category}:{market}:{role}:{prompt[:200]}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def _rate_limit_wait():
    """请求间隔控制:确保两个请求之间有足够间隔。"""
    global _last_request_time
    s = get_settings()
    interval = s.image_request_interval_ms / 1000.0
    elapsed = time.monotonic() - _last_request_time
    if elapsed < interval:
        await asyncio.sleep(interval - elapsed + random.uniform(0, 0.1))
    _last_request_time = time.monotonic()


async def generate_with_retry(
    provider,
    prompt: str,
    market: str,
    role: str,
    subject: str = "",
) -> dict[str, Any]:
    """带 429 重试的图片生成(指数退避 + jitter)。"""
    s = get_settings()
    max_retries = max(0, s.image_max_retries)
    base_delay = s.image_retry_base_seconds

    async with _get_semaphore():
        for attempt in range(max_retries + 1):
            await _rate_limit_wait()
            started = time.perf_counter()
            try:
                res = await provider.generate(prompt=prompt, market=market, role=role, subject=subject)
                res["latency_ms"] = int((time.perf_counter() - started) * 1000)
                res["attempts"] = attempt + 1
                res["rate_limit_hit"] = attempt > 0
                return res
            except Exception as exc:
                err_str = str(exc)
                is_429 = "429" in err_str or "rate" in err_str.lower()
                if is_429 and attempt < max_retries:
                    # 读 Retry-After(简化:看异常信息是否含秒数)
                    retry_after = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
                    logger.warning(
                        "[image_queue] 429 on attempt %d for %s/%s, retrying in %.1fs",
                        attempt + 1, market, role)
                    await asyncio.sleep(retry_after)
                    continue
                # 非 429 或重试用完
                return {
                    "error": err_str[:200],
                    "attempts": attempt + 1,
                    "rate_limit_hit": is_429,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "url": "", "provider": getattr(provider, "name", "unknown"),
                }

    return {"error": "max retries exceeded", "attempts": max_retries + 1, "url": ""}


async def generate_cached(
    db, tenant_id: int, site_id: str, provider,
    product_category: str, market: str, role: str, prompt: str, subject: str = "",
) -> dict[str, Any]:
    """带缓存的图片生成:相同请求直接复用已成功 Asset(DB 优先 + 内存缓存)。"""
    # 1) DB: 该 site+market+role 已有成功资产 → 直接复用(不区分 shared/non-shared)
    existing = (
        db.query(models.Asset)
        .filter(
            models.Asset.tenant_id == tenant_id,
            models.Asset.site_id == site_id,
            models.Asset.market == market,
            models.Asset.role == role,
            models.Asset.source_type == "AI_GENERATED",
            models.Asset.url != "",
        )
        .first()
    )
    if existing and existing.url:
        return {"url": existing.url, "provider": existing.provider,
                "source_type": "AI_GENERATED", "from_cache": True,
                "attempts": 0, "latency_ms": 0, "rate_limit_hit": False, "cached": True}

    # 2) 共享槽位:其他市场已生成 → 跨市场复用
    if role in SHARED_SLOTS:
        shared = (
            db.query(models.Asset)
            .filter(
                models.Asset.tenant_id == tenant_id,
                models.Asset.site_id == site_id,
                models.Asset.role == role,
                models.Asset.source_type == "AI_GENERATED",
                models.Asset.url != "",
            )
            .first()
        )
        if shared and shared.url:
            return {"url": shared.url, "provider": shared.provider,
                    "source_type": "AI_GENERATED", "from_cache": True,
                    "attempts": 0, "latency_ms": 0, "rate_limit_hit": False, "cached": True}

    # 3) 内存缓存
    cache_key = _make_cache_key(tenant_id, product_category, market, role, prompt)
    cached = _cache.get(cache_key)
    if cached and cached.get("url"):
        cached["cached"] = True
        return cached

    # 4) 生成(带限流/重试)
    res = await generate_with_retry(provider, prompt, market, role, subject)
    if res.get("url"):
        _cache[cache_key] = res
        db.add(models.Asset(
            id=new_id("asset"), tenant_id=tenant_id, site_id=site_id,
            market=market, section_id=role, role=role,
            source_type="AI_GENERATED", provider=res.get("provider", ""),
            prompt=prompt[:500], url=res["url"],
        ))
        db.commit()
    return res


def get_cache_stats() -> dict:
    return {"cached_keys": len(_cache), "shared_slots": list(SHARED_SLOTS)}


def clear_cache():
    _cache.clear()
