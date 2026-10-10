"""Profile Builder:聚合结果 → MarketDesignProfile(持久化,可复用/缓存)。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..database import SessionLocal
from ..utils import new_id
from . import models as wi_models
from .pattern_aggregator import aggregate as _aggregate


def build_and_save(
    db,
    tenant_id: int,
    research_project_id: str,
    industry: str,
    market: str,
    snapshots: list[dict],
) -> wi_models.MarketDesignProfile | None:
    """聚合 FeatureSnapshot → MarketDesignProfile 持久化。"""
    result = _aggregate(snapshots, industry, market)
    if result.get("warning"):
        return None  # 低置信度不落库

    domains = result.pop("source_domains", [])

    # 查重(同 industry+market+version 复用)
    existing = (
        db.query(wi_models.MarketDesignProfile)
        .filter(
            wi_models.MarketDesignProfile.industry == industry,
            wi_models.MarketDesignProfile.market == market,
        )
        .order_by(wi_models.MarketDesignProfile.created_at.desc())
        .first()
    )
    if existing and existing.sample_size >= result["sample_size"]:
        return existing  # 已有更好的样本,不覆盖

    profile = wi_models.MarketDesignProfile(
        id=new_id("wip"),
        tenant_id=tenant_id,
        research_project_id=research_project_id,
        industry=industry,
        market=market,
        locale=market,
        sample_size=result["sample_size"],
        layout_patterns=result.get("layout_patterns", {}),
        visual_patterns=result.get("visual_patterns", {}),
        content_patterns=result.get("content_patterns", {}),
        cta_patterns=result.get("cta_patterns", {}),
        trust_patterns=result.get("trust_patterns", {}),
        image_patterns=result.get("image_patterns", {}),
        seo_patterns=result.get("seo_patterns", {}),
        confidence=result.get("confidence", {}),
        source_domains=domains,
        version="1",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def get_cached_profile(db, industry: str, market: str) -> wi_models.MarketDesignProfile | None:
    """获取缓存的 Profile(未过期)。"""
    now = datetime.now(timezone.utc)
    return (
        db.query(wi_models.MarketDesignProfile)
        .filter(
            wi_models.MarketDesignProfile.industry == industry,
            wi_models.MarketDesignProfile.market == market,
            wi_models.MarketDesignProfile.sample_size >= 3,
        )
        .filter(
            (wi_models.MarketDesignProfile.expires_at.is_(None)) |
            (wi_models.MarketDesignProfile.expires_at > now)
        )
        .order_by(wi_models.MarketDesignProfile.sample_size.desc())
        .first()
    )
