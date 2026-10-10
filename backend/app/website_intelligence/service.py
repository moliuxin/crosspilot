"""WI Service:编排完整流程 Research → Fetch → Extract → Aggregate → Profile."""
from __future__ import annotations

import time
from typing import Any

from .. import models
from ..utils import new_id
from ..database import SessionLocal
from . import feature_extractor, profile_builder, source_discovery
from .fetcher import fetch_page, DomainRateLimiter


async def run_research(
    db,
    tenant_id: int,
    industry: str,
    product_category: str,
    market: str,
    buyer_roles: list[str] | None = None,
    reference_urls: list[str] | None = None,
    site_id: str = "",
) -> dict[str, Any]:
    """执行完整 Website Intelligence 流程。"""
    started = time.perf_counter()
    run_id = new_id("wir")

    # 1. 创建 Research Project
    project = models.WebsiteResearchProject(
        id=new_id("wrp"), tenant_id=tenant_id, site_id=site_id,
        industry=industry, product_category=product_category,
        market=market, locale=market, buyer_roles=buyer_roles or [],
        status="running",
    )
    db.add(project)
    db.commit()

    # 2. Source Discovery
    if reference_urls:
        provider = source_discovery.get_search_provider(reference_urls)
        queries = source_discovery.generate_queries(industry, market, product_category)
        # 手动 URL 优先
        all_urls = [{"url": u, "title": "", "domain": _domain(u)} for u in reference_urls]
    else:
        provider = source_discovery.get_search_provider()
        queries = source_discovery.generate_queries(industry, market, product_category)
        all_urls = []
        for q in queries:
            try:
                results = await provider.search(q, limit=5)
                all_urls.extend(results)
            except Exception:
                pass

    filtered = source_discovery.filter_sources(all_urls)[:15]  # 最多 15 个

    # 3. Fetch + Extract
    limiter = DomainRateLimiter(delay=1.0)
    sources = []
    snapshots = []

    for item in filtered:
        url = item["url"]
        domain = item["domain"]
        source = models.WebsiteSource(
            id=new_id("wis"), research_project_id=project.id,
            domain=domain, url=url, page_title=item.get("title", ""),
            source_type="official_company", crawl_status="pending",
        )
        db.add(source)
        db.commit()

        result = await fetch_page(url, limiter)
        source.http_status = result.status_code
        source.robots_allowed = result.robots_allowed

        if result.blocked or not result.html:
            source.crawl_status = "blocked" if result.blocked else "error"
            db.commit()
            continue

        source.crawl_status = "fetched"
        source.content_hash = result.content_hash
        from datetime import datetime, timezone
        source.fetched_at = datetime.now(timezone.utc)
        db.commit()

        # Feature Extraction
        features = feature_extractor.extract_features(result.html, url)
        snap = models.WebsiteFeatureSnapshot(
            id=new_id("wfs"), research_project_id=project.id,
            source_id=source.id, market=market,
            page_type=features.page_type,
            structure_features=features.structure,
            visual_features=features.visual,
            content_features=features.content,
            conversion_features=features.conversion,
            trust_features=features.trust,
            seo_features=features.seo,
        )
        db.add(snap)
        db.commit()

        sources.append(source)
        snapshots.append({
            "_domain": domain,
            "structure": features.structure,
            "visual": features.visual,
            "content": features.content,
            "conversion": features.conversion,
            "trust": features.trust,
            "seo": features.seo,
        })

    # 4. Aggregate → Profile
    profile = None
    if len(snapshots) >= 3:
        profile = profile_builder.build_and_save(
            db, tenant_id, project.id, industry, market, snapshots,
        )

    # 5. Complete
    project.status = "completed"
    db.commit()

    latency = int((time.perf_counter() - started) * 1000)
    run = models.WebsiteIntelligenceRun(
        id=run_id, tenant_id=tenant_id, site_id=site_id,
        research_project_id=project.id,
        provider="rule_engine", model="",
        sources_discovered=len(filtered), sources_successful=len(snapshots),
        latency_ms=latency, status="completed",
    )
    db.add(run)
    db.commit()

    return {
        "research_project": project.to_dict(),
        "sources": [{"domain": s.domain, "status": s.crawl_status, "http": s.http_status} for s in sources],
        "profile": profile.to_dict() if profile else None,
        "run": {"id": run.id, "latency_ms": latency,
                "sources_discovered": len(filtered), "sources_successful": len(snapshots)},
    }


def _domain(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).netloc
