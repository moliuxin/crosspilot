"""Website Intelligence 数据模型。"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..models import utcnow


class WebsiteResearchProject(Base):
    """研究项目:一次市场情报分析任务。"""

    __tablename__ = "wi_research_projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="", index=True)

    industry: Mapped[str] = mapped_column(String(64), default="")
    product_category: Mapped[str] = mapped_column(String(255), default="")
    market: Mapped[str] = mapped_column(String(16), default="en-US")
    locale: Mapped[str] = mapped_column(String(16), default="")
    buyer_roles: Mapped[list] = mapped_column(JSON, default=list)

    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/running/completed/failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "tenant_id": self.tenant_id, "site_id": self.site_id,
            "industry": self.industry, "product_category": self.product_category,
            "market": self.market, "locale": self.locale, "buyer_roles": self.buyer_roles,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WebsiteSource(Base):
    """被分析的公开网页(只存元数据,不存 HTML)。"""

    __tablename__ = "wi_sources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    research_project_id: Mapped[str] = mapped_column(String(64), index=True)

    domain: Mapped[str] = mapped_column(String(255), default="")
    url: Mapped[str] = mapped_column(Text, default="")
    page_title: Mapped[str] = mapped_column(String(512), default="")
    source_type: Mapped[str] = mapped_column(String(32), default="official_company")

    crawl_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/fetched/blocked/error
    robots_allowed: Mapped[bool] = mapped_column(default=True)
    http_status: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), default="")

    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "domain": self.domain, "url": self.url,
            "page_title": self.page_title, "source_type": self.source_type,
            "crawl_status": self.crawl_status, "robots_allowed": self.robots_allowed,
            "http_status": self.http_status,
        }


class WebsiteFeatureSnapshot(Base):
    """网页抽象特征快照(不是 HTML 副本)。"""

    __tablename__ = "wi_feature_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    research_project_id: Mapped[str] = mapped_column(String(64), index=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True)
    market: Mapped[str] = mapped_column(String(16), default="en-US")

    page_type: Mapped[str] = mapped_column(String(32), default="homepage")

    structure_features: Mapped[dict] = mapped_column(JSON, default=dict)
    visual_features: Mapped[dict] = mapped_column(JSON, default=dict)
    content_features: Mapped[dict] = mapped_column(JSON, default=dict)
    conversion_features: Mapped[dict] = mapped_column(JSON, default=dict)
    trust_features: Mapped[dict] = mapped_column(JSON, default=dict)
    seo_features: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "source_id": self.source_id, "market": self.market,
            "page_type": self.page_type,
            "structure": self.structure_features,
            "visual": self.visual_features,
            "content": self.content_features,
            "conversion": self.conversion_features,
            "trust": self.trust_features,
            "seo": self.seo_features,
        }


class MarketDesignProfile(Base):
    """市场设计画像:多源统计聚合 → 可复用的设计情报。"""

    __tablename__ = "wi_market_design_profiles"
    __table_args__ = (
        UniqueConstraint("industry", "market", "version", name="uq_wi_profile_ind_mkt_ver"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    research_project_id: Mapped[str] = mapped_column(String(64), default="", index=True)

    industry: Mapped[str] = mapped_column(String(64), default="", index=True)
    market: Mapped[str] = mapped_column(String(16), default="", index=True)
    locale: Mapped[str] = mapped_column(String(16), default="")

    sample_size: Mapped[int] = mapped_column(Integer, default=0)

    layout_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    visual_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    content_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    cta_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    trust_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    image_patterns: Mapped[dict] = mapped_column(JSON, default=dict)
    seo_patterns: Mapped[dict] = mapped_column(JSON, default=dict)

    confidence: Mapped[dict] = mapped_column(JSON, default=dict)
    source_domains: Mapped[list] = mapped_column(JSON, default=list)

    version: Mapped[str] = mapped_column(String(16), default="1")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "industry": self.industry, "market": self.market,
            "sample_size": self.sample_size,
            "layout_patterns": self.layout_patterns,
            "visual_patterns": self.visual_patterns,
            "content_patterns": self.content_patterns,
            "cta_patterns": self.cta_patterns,
            "trust_patterns": self.trust_patterns,
            "image_patterns": self.image_patterns,
            "confidence": self.confidence,
            "source_domains": self.source_domains,
            "version": self.version,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WebsiteIntelligenceRun(Base):
    """执行日志(审计)。"""

    __tablename__ = "wi_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="")
    research_project_id: Mapped[str] = mapped_column(String(64), default="")

    provider: Mapped[str] = mapped_column(String(32), default="rule_engine")
    model: Mapped[str] = mapped_column(String(64), default="")

    sources_discovered: Mapped[int] = mapped_column(Integer, default=0)
    sources_successful: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
