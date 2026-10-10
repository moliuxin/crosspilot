"""Fetcher:robots 检查 + 限速 + 超时 + Content-Type 检查;不绕过反爬。"""
from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "CrossPilot-Bot/1.0 (market design intelligence; +https://crosspilot.ai/bot)"
MAX_PAGE_SIZE = 2 * 1024 * 1024  # 2MB
TIMEOUT = 15.0
DOMAIN_DELAY = 2.0  # 同域名间隔秒


@dataclass
class FetchResult:
    url: str
    domain: str
    status_code: int = 0
    html: str = ""
    content_hash: str = ""
    robots_allowed: bool = True
    blocked: bool = False
    error: str = ""


class DomainRateLimiter:
    def __init__(self, delay: float = DOMAIN_DELAY):
        self.delay = delay
        self._last: dict[str, float] = {}

    async def wait(self, domain: str):
        last = self._last.get(domain, 0)
        elapsed = time.monotonic() - last
        if elapsed < self.delay:
            await asyncio.sleep(self.delay - elapsed)
        self._last[domain] = time.monotonic()


async def check_robots(client: httpx.AsyncClient, url: str) -> bool:
    """检查 robots.txt 是否允许访问该 URL。"""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        resp = await client.get(robots_url, timeout=5, follow_redirects=True)
        if resp.status_code != 200:
            return True  # 没有 robots.txt → 默认允许
        rp = RobotFileParser()
        rp.parse(resp.text.splitlines())
        return rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True  # 网络错误时默认允许(不因 robots 请求失败而跳过)


async def fetch_page(url: str, limiter: DomainRateLimiter | None = None) -> FetchResult:
    """抓取单个公开页面;robots → 限速 → GET → Content-Type/大小检查。"""
    parsed = urlparse(url)
    domain = parsed.netloc
    result = FetchResult(url=url, domain=domain)

    if limiter is None:
        limiter = DomainRateLimiter()

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(TIMEOUT),
    ) as client:
        # 1) robots 检查
        allowed = await check_robots(client, url)
        result.robots_allowed = allowed
        if not allowed:
            result.blocked = True
            result.error = "robots_disallowed"
            return result

        # 2) 域名限速
        await limiter.wait(domain)

        # 3) GET
        try:
            resp = await client.get(url)
            result.status_code = resp.status_code

            if resp.status_code == 403 or resp.status_code == 429:
                result.blocked = True
                result.error = f"http_{resp.status_code}"
                return result

            if resp.status_code != 200:
                result.error = f"http_{resp.status_code}"
                return result

            # Content-Type 检查(只要 HTML)
            ct = resp.headers.get("content-type", "")
            if "text/html" not in ct and "application/xhtml" not in ct:
                result.error = f"content_type_{ct[:30]}"
                return result

            # 大小限制
            body = resp.text[:MAX_PAGE_SIZE]
            result.html = body
            result.content_hash = hashlib.sha256(body.encode()).hexdigest()[:16]

        except httpx.TimeoutException:
            result.error = "timeout"
        except Exception as exc:
            result.error = f"error_{type(exc).__name__}"
            result.blocked = "challenge" in str(exc).lower() or "cloudflare" in str(exc).lower()

    return result


async def fetch_batch(urls: list[str], max_concurrent: int = 3) -> list[FetchResult]:
    """并发抓取一批 URL(限制并发数,避免压垮目标站)。"""
    limiter = DomainRateLimiter()
    sem = asyncio.Semaphore(max_concurrent)

    async def _fetch(u):
        async with sem:
            return await fetch_page(u, limiter)

    return list(await asyncio.gather(*[_fetch(u) for u in urls], return_exceptions=False))
