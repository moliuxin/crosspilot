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

        # 资产 URL 注入区块 props(hero.image 等)供 site-blocks 渲染真实 <img>
        for s in sections:
            slot = "hero" if s.get("type") == "hero" else s.get("type")
            hit = manifest.get(slot) or manifest.get("hero")
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
    """按槽位声明解析图片:REAL(用户产品图)→ AI_GENERATED(ImageProvider)→ FALLBACK。"""
    from ..image_provider import get_image_provider
    from ..skills.market_transcreation import FORBIDDEN_AI_ROLES

    brief_skill_in = {"product_category": category, "market": market, "industry": industry_id}
    slots: list[str] = []
    for s in sections:
        for slot_meta in s.get("component_meta", {}).get("asset_slots", []):
            if not slot_meta.get("required", False) and slot_meta.get("slot") not in ("hero",):
                continue
            slots.append(slot_meta["slot"])
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
        # 1) REAL:产品真实图优先(仅非 hero 槽位用产品图;hero 用场景图)
        if slot != "hero" and real_images:
            try:
                url = next(real_iter)
                _save_asset(db, tenant_id, site, market, slot, url, "REAL", provider_name="user_upload")
                manifest[slot] = {"source_type": "REAL", "url": url}
                continue
            except StopIteration:
                pass
        # 2) AI_GENERATED
        try:
            res = await provider.generate(
                prompt=f"{b.get('subject','')} | {b.get('scene','')} | {b.get('negative_prompt','')}",
                market=market, role=slot, subject=b.get("subject", ""))
            _save_asset(db, tenant_id, site, market, slot, res["url"], "AI_GENERATED",
                        provider_name=res.get("provider", ""), prompt=f"{b.get('subject','')}")
            manifest[slot] = {"source_type": "AI_GENERATED", "url": res["url"], "provider": res.get("provider", "")}
            continue
        except Exception as exc:  # 3) FALLBACK
            logger.warning("槽位 %s 生成失败,使用 FALLBACK:%s", slot, str(exc)[:80])
        manifest[slot] = {"source_type": "FALLBACK", "url": "", "note": "未生成,渲染时用占位样式"}
    db.commit()
    return manifest


def _save_asset(db, tenant_id, site, market, slot, url, source_type, provider_name="", prompt="") -> None:
    db.add(models.Asset(
        id=new_id("asset"), tenant_id=tenant_id, site_id=site.id, market=market,
        section_id=slot, role=slot, source_type=source_type, provider=provider_name,
        prompt=prompt, url=url,
    ))
