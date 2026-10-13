"""市场变体生成服务(PHASE 6/8/9 串接)。

generate_variants(site, ...):
  IndustryIntelligence → (每市场) ThemeStyle + LayoutPlanning + Transcreation
  → Asset Slot 结构解析(REAL 立即落位,AI 槽位标 PENDING)
  → 持久化 SiteMarketVariant(site_id+market 唯一,upsert)。

fill_pending_images(...):
  后台任务,按优先级(预览市场 → hero → application_scene → 其余)逐张补图,
  走 image_queue(串行 + 429 退避 + 缓存 + 共享),每张完成即落库可查。

Product Fact Layer 只读引用,绝不写进变体。
"""
from __future__ import annotations

import copy
import logging
import time
from typing import Any

from .. import knowledge, models
from ..skills import registry
from ..skills.base import SkillContext
from ..skills.component_registry import COMPONENTS
from ..utils import new_id

logger = logging.getLogger(__name__)

MARKETS = ("zh-CN", "en-US", "ru-RU")

# Case 区块在无真实案例时的概念化标签(明确 AI_GENERATED_CONCEPT,不伪装 Customer Case)
CASE_CONCEPT_LABELS = {
    "zh-CN": "应用场景概念展示",
    "en-US": "Application Concepts",
    "ru-RU": "Концепция применения",
}

# 图片补齐优先级:用户正在预览的市场最先;槽位 hero → application_scene → 其余
SLOT_PRIORITY = ("hero", "application_scene")

# section type → asset slot 映射(certifications 等事实性元素禁止 AI 图;
# factory 复用 application_scene,不单独调 API,保证总预算 ≤ 7 次)
SECTION_TO_SLOT = {
    "hero": "hero",
    "products": "product_cover",
    "applications": "application_scene",
    "cases": "case",
    "factory": "application_scene",
    "certifications": None,
    "supply_capability": "application_scene",
    "technical_details": "application_scene",
}

# 槽位别名:声明了这些 slot 的区块直接复用别名槽位的图,不生成新图
SLOT_ALIASES = {"factory": "application_scene"}

# 后台补图任务注册表:site_id → job 状态(供 GET /visuals/status 展示真实进度)
_image_jobs: dict[str, dict[str, Any]] = {}


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

        # 资产 URL 注入所有有图区块(使用模块级 SECTION_TO_SLOT 映射)
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
            # Case 区块:无真实案例时概念化展示,禁止伪装 Customer Case
            if sec_type == "cases":
                case_info = manifest.get("case") or {}
                if case_info.get("source_type") != "REAL":
                    app_hit = manifest.get("application_scene") or {}
                    s["props"] = {
                        **s.get("props", {}),
                        "title": CASE_CONCEPT_LABELS.get(market, CASE_CONCEPT_LABELS["en-US"]),
                        "concept": True,
                        "image_source": "AI_GENERATED_CONCEPT",
                        "disclaimer": True,
                        **({"image": app_hit["url"]} if app_hit.get("url") else {}),
                    }

        # SEO 元数据(每市场独立 Title/Description/Canonical/hreflang)
        hero_copy = (copy.get("hero") or {})
        base_title = hero_copy.get("title") or f"{site.name} — {category}"
        variant.seo_metadata = {
            "title": base_title[:70],
            "description": (hero_copy.get("description") or (knowledge.get_industry(industry_id) or {}).get("summary", ""))[:160],
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
    """Asset Slot 结构解析(不调用图片 API,不阻塞站点生成)。

    - REAL:产品真实图立即可用
    - AI_GENERATED_CONCEPT:case 槽位固定走概念展示(复用 application_scene,不调 API)
    - FORBIDDEN_AI_ROLES:事实性元素一律跳过
    - 其余(hero/application_scene/product_cover/...):标 PENDING,由
      fill_pending_images() 后台补齐 —— 站点结构先生成,图片异步到位。
    """
    from ..skills.market_transcreation import FORBIDDEN_AI_ROLES

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

    manifest: dict[str, Any] = {}
    real_iter = iter(real_images)
    for b in briefs:
        slot = b["slot"]
        # 别名槽位:复用别名槽位的图,不单独调 API(预算控制)
        if slot in SLOT_ALIASES:
            continue
        if slot in FORBIDDEN_AI_ROLES:
            manifest[slot] = {"source_type": "FALLBACK", "url": "",
                              "note": "事实性元素,需真实素材,AI 不生成", "reason_code": "forbidden_role"}
            continue

        # Case:AI 不得生成图片伪装真实客户案例 → 概念展示(复用 application_scene)
        if slot == "case":
            manifest[slot] = {"source_type": "AI_GENERATED_CONCEPT", "url": "",
                              "note": "无真实案例,以 Application Concept 概念展示",
                              "reason_code": "case_requires_real"}
            continue

        # 1) REAL:产品真实图优先(三个市场共享真实产品图)
        if slot != "hero" and real_images:
            try:
                url = next(real_iter)
                _save_asset(db, tenant_id, site, market, slot, url, "REAL", provider_name="user_upload")
                manifest[slot] = {"source_type": "REAL", "url": url}
                continue
            except StopIteration:
                pass

        # 2) AI 槽位 → PENDING,后台补图
        manifest[slot] = {"source_type": "PENDING", "url": "", "status": "queued",
                          "subject": b.get("subject", ""),
                          "scene": b.get("scene", ""),
                          "negative_prompt": b.get("negative_prompt", "")}

    db.commit()
    return manifest


def _image_job(site_id: str) -> dict[str, Any]:
    return _image_jobs.setdefault(site_id, {
        "status": "idle", "total": 0, "done": 0, "failed": 0,
        "results": [], "started_at": "", "finished_at": "",
    })


def visuals_job_status(db, site_id: str) -> dict[str, Any]:
    """GET /visuals/status 用:任务进度 + 各市场 AI/FALLBACK/PENDING 计数与原因。"""
    job = dict(_image_jobs.get(site_id) or {"status": "idle", "total": 0, "done": 0, "failed": 0})
    job["results"] = (job.get("results") or [])[-12:]
    markets: list[dict[str, Any]] = []
    variants = (
        db.query(models.SiteMarketVariant)
        .filter(models.SiteMarketVariant.site_id == site_id)
        .all()
    )
    for v in variants:
        counts = {"AI": 0, "FALLBACK": 0, "PENDING": 0, "REAL": 0, "CONCEPT": 0}
        reasons: list[str] = []
        for slot, info in (v.asset_manifest or {}).items():
            st = info.get("source_type", "")
            if st == "AI_GENERATED":
                counts["AI"] += 1
            elif st == "PENDING":
                counts["PENDING"] += 1
            elif st == "REAL":
                counts["REAL"] += 1
            elif st == "AI_GENERATED_CONCEPT":
                counts["CONCEPT"] += 1
            else:
                counts["FALLBACK"] += 1
                if info.get("error_code") == "429" or "rate" in (info.get("note") or "").lower():
                    reasons.append(f"{slot}: Provider Rate Limited")
                elif info.get("note"):
                    reasons.append(f"{slot}: {info['note'][:60]}")
        markets.append({"market": v.market, **counts, "reasons": reasons[:4]})
    return {"job": job, "markets": markets}


def reset_image_jobs() -> None:
    """测试辅助:清空任务注册表。"""
    _image_jobs.clear()


async def fill_pending_images(db, tenant_id: int, site_id: str, priority_market: str = "") -> None:
    """后台补图:按 优先市场 → hero → application_scene → 其余 逐张生成。

    走 image_queue(串行 + 429 退避 + DB/共享缓存);每张完成即更新
    manifest + section props + Asset 行并提交,前端轮询可见渐进进度。
    使用调用方(请求级)会话:FastAPI 在后台任务结束后才关闭依赖会话。
    """
    from ..image_provider import get_image_provider
    from .image_queue import generate_cached

    job = _image_job(site_id)
    try:
        site = db.get(models.Site, site_id)
        if site is None:
            return
        variants = (
            db.query(models.SiteMarketVariant)
            .filter(models.SiteMarketVariant.site_id == site_id)
            .all()
        )
        markets = [v.market for v in variants]
        if priority_market in markets:
            markets = [priority_market] + [m for m in markets if m != priority_market]
        by_market = {v.market: v for v in variants}
        category = site.product_category or site.name or ""
        provider = get_image_provider()

        # 统计待补图片总数,登记任务
        pending_list: list[tuple[str, str]] = []
        for m in markets:
            v = by_market[m]
            slots = [s for s, i in (v.asset_manifest or {}).items() if i.get("source_type") == "PENDING"]
            slots.sort(key=lambda x: (SLOT_PRIORITY.index(x) if x in SLOT_PRIORITY else len(SLOT_PRIORITY), x))
            for s in slots:
                pending_list.append((m, s))
        job.update({"status": "running", "total": len(pending_list), "done": 0, "failed": 0,
                    "results": [], "started_at": time.time(), "finished_at": ""})

        for market, slot in pending_list:
            v = by_market[market]
            # 拷贝后修改:原地改已加载的 JSON dict 会让 flush 时新旧值相等,
            # ORM 判定无变化而丢更新(缓存命中路径无内部 commit,必现)
            manifest = dict(v.asset_manifest or {})
            info = manifest.get(slot) or {}

            # 生成(队列内:限速/重试/缓存/共享)
            prompt = f"{info.get('subject', '')} | {info.get('scene', '')} | {info.get('negative_prompt', '')}"
            try:
                res = await generate_cached(
                    db, tenant_id, site_id, provider,
                    product_category=category, market=market, role=slot,
                    prompt=prompt, subject=info.get("subject", ""),
                )
            except Exception as exc:  # noqa: BLE001 — 单张失败不阻断后续
                logger.warning("补图异常 %s/%s:%s", market, slot, str(exc)[:80])
                res = {"url": "", "status": "failed", "error": str(exc)[:120],
                       "error_code": type(exc).__name__, "attempts": 0, "rate_limit_hit": False}

            if res.get("url"):
                manifest[slot] = {
                    "source_type": "AI_GENERATED", "url": res["url"],
                    "provider": res.get("provider", ""),
                    "cached": res.get("cached", False),
                    "attempts": res.get("attempts", 1),
                    "retries": res.get("retries", 0),
                    "rate_limit_hit": res.get("rate_limit_hit", False),
                    "latency_ms": res.get("latency_ms", 0),
                    "status": "success",
                }
                job["done"] += 1
                job["results"].append({"market": market, "slot": slot, "status": "success",
                                       "cached": res.get("cached", False),
                                       "rate_limit_hit": res.get("rate_limit_hit", False)})
            else:
                manifest[slot] = {
                    "source_type": "FALLBACK", "url": "", "status": "failed",
                    "note": f"生成失败({(res.get('error') or 'unknown')[:80]})",
                    "error_code": res.get("error_code", ""),
                    "attempts": res.get("attempts", 0),
                    "retries": res.get("retries", 0),
                    "rate_limit_hit": res.get("rate_limit_hit", False),
                    "reason_code": "rate_limited" if res.get("rate_limit_hit") else "provider_error",
                }
                job["failed"] += 1
                job["results"].append({"market": market, "slot": slot, "status": "fallback",
                                       "error_code": res.get("error_code", "")})

            # 注入 section props(含 case 概念复用 application_scene);deepcopy 同理防丢更新
            sections = copy.deepcopy((v.layout_schema or {}).get("sections", []))
            for s in sections:
                sec_type = s.get("type", "")
                mapped = SECTION_TO_SLOT.get(sec_type, sec_type)
                hit = manifest.get(mapped) if mapped else None
                if not hit and sec_type == "hero":
                    hit = manifest.get("hero")
                if hit and hit.get("url"):
                    s["props"] = {**s.get("props", {}), "image": hit["url"],
                                  "image_source": hit.get("source_type", "")}
                if sec_type == "cases":
                    case_info = manifest.get("case") or {}
                    if case_info.get("source_type") != "REAL":
                        app_hit = manifest.get("application_scene") or {}
                        s["props"] = {
                            **s.get("props", {}),
                            "title": CASE_CONCEPT_LABELS.get(market, CASE_CONCEPT_LABELS["en-US"]),
                            "concept": True,
                            "image_source": "AI_GENERATED_CONCEPT",
                            "disclaimer": True,
                            **({"image": app_hit["url"]} if app_hit.get("url") else {}),
                        }
            v.asset_manifest = dict(manifest)  # 新对象确保 JSON 列脏检测(原地改不触发 UPDATE)
            v.layout_schema = {"sections": sections, "layout_source": (v.layout_schema or {}).get("layout_source", "template")}
            db.commit()

        job["status"] = "done"
        job["finished_at"] = time.time()
    except Exception as exc:  # noqa: BLE001
        logger.exception("后台补图任务失败 site=%s:%s", site_id, exc)
        job["status"] = "error"
        job["error"] = str(exc)[:200]
        db.rollback()


def _save_asset(db, tenant_id, site, market, slot, url, source_type, provider_name="", prompt="") -> None:
    db.add(models.Asset(
        id=new_id("asset"), tenant_id=tenant_id, site_id=site.id, market=market,
        section_id=slot, role=slot, source_type=source_type, provider=provider_name,
        prompt=prompt, url=url,
    ))
