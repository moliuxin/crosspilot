"""市场变体生成服务(PHASE 6/8/9 串接)。

generate_variants(site, ...):
  IndustryIntelligence → (每市场) ThemeStyle + LayoutPlanning + Transcreation
  → VisualBrief → VisualGeneration(槽位 REAL>AI_GENERATED>FALLBACK)
  → 持久化 SiteMarketVariant(site_id+market 唯一,upsert)。

Product Fact Layer 只读引用,绝不写进变体。
"""
from __future__ import annotations

import logging
from typing import Any

from .. import knowledge, models
from ..skills import registry
from ..skills.base import SkillContext
from ..skills.component_registry import COMPONENTS
from ..utils import new_id

logger = logging.getLogger(__name__)

MARKETS = ("zh-CN", "en-US", "ru-RU")


async def generate_variants(db, tenant_id: int, site: models.Site, *, regenerate: bool = False) -> list[models.SiteMarketVariant]:
    category = site.product_category or site.name or ""
    ctx_base = SkillContext(tenant_id=tenant_id, site_id=site.id)

    industry_res, _ = await registry.run("industry_intelligence", ctx_base,
                                         {"product_category": category, "product_description": site.industry or ""},
                                         db=db, deduct_credits=False)
    industry_id = (industry_res.output.get("industry") if industry_res else None) or "general_b2b"

    # 产品事实层(只读):真实图片 URL 供 REAL 槽位优先使用
    products = db.query(models.Product).filter(models.Product.tenant_id == tenant_id).all()
    real_images: list[str] = []
    for p in products:
        for img in (p.images or [])[:3]:
            if isinstance(img, str) and img:
                real_images.append(img)

    out: list[models.SiteMarketVariant] = []
    for market in (site.target_markets or list(MARKETS)):
        if market not in MARKETS:
            continue
        ctx = SkillContext(tenant_id=tenant_id, site_id=site.id, market=market)

        theme, _ = await registry.run("theme_style", ctx, {"industry": industry_id}, db=db, deduct_credits=False)
        layout, _ = await registry.run("layout_planning", ctx,
                                       {"market": market, "product_category": category, "industry": industry_id},
                                       db=db, deduct_credits=False)
        trans, _ = await registry.run("market_transcreation", ctx,
                                      {"market": market, "product_category": category, "industry": industry_id},
                                      db=db, deduct_credits=False)

        sections = (layout.output.get("sections") if layout else None) or []
        tokens = (theme.output.get("design_tokens") if theme else {}) or {}
        copy = (trans.output.get("copy") if trans else {}) or {}
        # hero 文案写进首屏 section props
        if copy.get("hero"):
            for s in sections:
                if s.get("type") == "hero":
                    s["props"] = {**s.get("props", {}), **copy["hero"]}

        # ---- upsert 变体行(site_id+market 唯一)----
        variant = (
            db.query(models.SiteMarketVariant)
            .filter(models.SiteMarketVariant.site_id == site.id,
                    models.SiteMarketVariant.market == market)
            .first()
        )
        if variant is None:
            variant = models.SiteMarketVariant(
                id=new_id("smv"), tenant_id=tenant_id, site_id=site.id, market=market, locale=market)
            db.add(variant)

        # ---- Asset Slot 管线(PHASE 8):REAL > AI_GENERATED > FALLBACK ----
        manifest = await resolve_slots(db, tenant_id, site, market, sections, real_images, category, industry_id)

        # 资产 URL 注入所有有图区块(section type → slot name 映射)
        SECTION_TO_SLOT = {
            "hero": "hero",
            "products": "product_cover",
            "applications": "application_scene",
            "cases": "case",
            "factory": "factory",
            "certifications": None,  # 事实性元素禁止 AI 图
            "supply_capability": "application_scene",
            "technical_details": "application_scene",
        }
        for s in sections:
            sec_type = s.get("type", "")
            slot = SECTION_TO_SLOT.get(sec_type, sec_type)
            # 查找匹配:先精确匹配 → 再 fallback hero(仅 hero 类区块用 hero 兜底)
            hit = manifest.get(slot) if slot else None
            if not hit and sec_type in ("hero",):
                hit = manifest.get("hero")
            if hit and hit.get("url"):
                s["props"] = {**s.get("props", {}), "image": hit["url"],
                              "image_source": hit.get("source_type", "")}

        # SEO 元数据(每市场独立 Title/Description/Canonical/hreflang)
        hero_copy = (copy.get("hero") or {})
        base_title = hero_copy.get("title") or f"{site.name} — {category}"
        variant.seo_metadata = {
            "title": base_title[:70],
            "description": (hero_copy.get("description") or industry.get("summary", ""))[:160],
            "canonical": f"/site/{site.public_slug}/{market}/",
            "hreflang": {m: f"/site/{site.public_slug}/{m}/" for m in MARKETS},
            "og_type": "website",
        }
        variant.layout_schema = {"sections": sections, "layout_source": layout.output.get("layout_source", "template") if layout else "template"}
        variant.content_json = {"copy": copy, "quality_report": (trans.output.get("quality_report") if trans else [])}
        variant.design_tokens = tokens
        variant.visual_style_profile = {"palette_family": (knowledge.get_industry(industry_id) or {}).get("visual_hints", {}).get("palette_family", ""),
                                        "market_style": knowledge.market_knowledge(market).get("style", {})}
        variant.asset_manifest = manifest
        out.append(variant)

    db.commit()
    for v in out:
        db.refresh(v)
    return out


async def resolve_slots(db, tenant_id, site, market, sections, real_images, category, industry_id) -> dict:
    """按槽位声明解析图片(队列版:限流+重试+缓存+共享)。

    槽位分类:
    - hero / application_scene:市场特定,每市场独立生成(最多 3×2=6 次)
    - product_cover:跨市场共享,只生成 1 次
    - case:禁止 AI 生成"真实客户案例"(改为 Application Concept 或隐藏)
    - FORBIDDEN_AI_ROLES:事实性元素一律跳过
    """
    from ..image_provider import get_image_provider
    from ..skills.market_transcreation import FORBIDDEN_AI_ROLES
    from .image_queue import generate_cached, SHARED_SLOTS

    brief_skill_in = {"product_category": category, "market": market, "industry": industry_id}
    slots: list[str] = []
    for s in sections:
        for slot_meta in s.get("component_meta", {}).get("asset_slots", []):
            slot_name = slot_meta.get("slot", "")
            if slot_name and slot_name not in FORBIDDEN_AI_ROLES:
                slots.append(slot_name)
    slots = list(dict.fromkeys(slots)) or ["hero"]

    ctx = SkillContext(tenant_id=tenant_id, site_id=site.id, market=market)
    brief_res, _ = await registry.run("visual_brief", ctx, {**brief_skill_in, "slots": slots},
                                      db=db, deduct_credits=False)
    briefs = (brief_res.output.get("briefs") if brief_res else []) or []
    provider = get_image_provider()

    manifest: dict[str, Any] = {}
    real_iter = iter(real_images)
    for b in briefs:
        slot = b["slot"]
        if slot in FORBIDDEN_AI_ROLES:
            manifest[slot] = {"source_type": "FALLBACK", "url": "", "note": "事实性元素,需真实素材,AI 不生成"}
            continue

        # Case:禁止 AI 伪装真实客户案例
        if slot == "case":
            manifest[slot] = {"source_type": "FALLBACK", "url": "",
                              "note": "案例需真实素材;可改为 Application Concept 展示"}
            continue

        # 1) REAL:产品真实图优先
        if slot != "hero" and real_images:
            try:
                url = next(real_iter)
                _save_asset(db, tenant_id, site, market, slot, url, "REAL", provider_name="user_upload")
                manifest[slot] = {"source_type": "REAL", "url": url}
                continue
            except StopIteration:
                pass

        # 2) AI_GENERATED(带限流/重试/缓存)
        prompt = f"{b.get('subject','')} | {b.get('scene','')} | {b.get('negative_prompt','')}"
        try:
            res = await generate_cached(
                db, tenant_id, site.id, provider,
                product_category=category, market=market, role=slot,
                prompt=prompt, subject=b.get("subject", ""),
            )
            if res.get("url"):
                manifest[slot] = {
                    "source_type": "AI_GENERATED", "url": res["url"],
                    "provider": res.get("provider", ""),
                    "cached": res.get("cached", False),
                    "attempts": res.get("attempts", 1),
                }
            else:
                manifest[slot] = {
                    "source_type": "FALLBACK", "url": "",
                    "note": f"生成失败({res.get('error','unknown')[:60]})",
                    "attempts": res.get("attempts", 0),
                }
        except Exception as exc:
            logger.warning("槽位 %s 生成异常:%s", slot, str(exc)[:80])
            manifest[slot] = {"source_type": "FALLBACK", "url": "", "note": f"异常:{str(exc)[:60]}"}

    db.commit()
    return manifest


def _save_asset(db, tenant_id, site, market, slot, url, source_type, provider_name="", prompt="") -> None:
    db.add(models.Asset(
        id=new_id("asset"), tenant_id=tenant_id, site_id=site.id, market=market,
        section_id=slot, role=slot, source_type=source_type, provider=provider_name,
        prompt=prompt, url=url,
    ))
