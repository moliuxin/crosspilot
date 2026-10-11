"""多站点端点：站点列表 / 创建 / 详情 / 更新 / 删除。

隔离规则（P0-MULTI-SITE 硬约束）：
- 全部端点要求登录（tenant_scope），且只能看到/操作本租户的站点；
- 跨租户访问他人站点一律 404（不泄露存在性）；
- 默认站点（迁移承载旧数据）不可删除。
"""
import secrets

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import list_sites, require_site
from ..utils import new_id, slugify

router = APIRouter(prefix="/sites", tags=["sites"])


def _with_counts(db: Session, sites: list[models.Site]) -> list[dict]:
    """为站点列表附上页面数 / 询盘数（我的网站卡片展示用）。"""
    if not sites:
        return []
    ids = [s.id for s in sites]
    page_counts = dict(
        db.query(models.Page.site_id, func.count(models.Page.id))
        .filter(models.Page.site_id.in_(ids))
        .group_by(models.Page.site_id)
        .all()
    )
    inquiry_counts = dict(
        db.query(models.Inquiry.site_id, func.count(models.Inquiry.id))
        .filter(models.Inquiry.site_id.in_(ids))
        .group_by(models.Inquiry.site_id)
        .all()
    )
    result = []
    for s in sites:
        s._counts = {
            "pages": page_counts.get(s.id, 0),
            "inquiries": inquiry_counts.get(s.id, 0),
        }
        result.append(s.to_dict())
    return result


def _unique_slug(db: Session, tenant_id: int, name: str, exclude_id: str = "") -> str:
    """租户内唯一 slug。中文名 slugify 后为空 → 回落 site，冲突时追加序号。"""
    base = slugify(name)
    if not base or base == "product":
        base = "site"
    slug = base
    n = 1
    while (
        db.query(models.Site)
        .filter(
            models.Site.tenant_id == tenant_id,
            models.Site.slug == slug,
            models.Site.id != exclude_id,
            models.Site.status != "archived",
        )
        .first()
        is not None
    ):
        n += 1
        slug = f"{base}-{n}"
    return slug


def seed_site_pages(db: Session, tenant_id: int, site: models.Site) -> None:
    """为新站点播种默认页面（与旧租户首次访问 /pages 的播种一致）。

    兼容：若租户已有「无站点归属」的孤儿页面（旧版隐式单站流程产生的），
    直接把它们收编到新站点，避免同一租户出现两套重复页面。
    """
    from .pages import _default_sections

    orphans = (
        db.query(models.Page)
        .filter(models.Page.tenant_id == tenant_id, models.Page.site_id == "")
        .all()
    )
    if orphans:
        for idx, page in enumerate(sorted(orphans, key=lambda p: p.order_index or 0)):
            page.site_id = site.id
            page.order_index = idx
        return

    presets = [
        ("首页", "/", True, 0),
        ("产品中心", "/products", False, 1),
        ("解决方案", "/solutions", False, 2),
        ("案例", "/cases", False, 3),
        ("关于我们", "/about", False, 4),
        ("联系我们", "/contact", False, 5),
    ]
    for name, slug, is_home, idx in presets:
        db.add(
            models.Page(
                id=new_id("page"),
                tenant_id=tenant_id,
                site_id=site.id,
                name=name,
                slug=slug,
                sections=_default_sections() if is_home else _default_sections()[:3],
                is_home=is_home,
                order_index=idx,
                seo_title=f"{name} | {site.name}",
                seo_description=f"{name} page of {site.name}.",
            )
        )


@router.get("")
def list_sites_endpoint(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """本租户的站点列表。新注册账号返回空列表（站点由用户显式创建）。"""
    sites = list_sites(db, tid, include_archived=include_archived)
    return {"ok": True, "sites": _with_counts(db, sites)}


@router.post("", status_code=201)
def create_site(payload: schemas.SiteCreate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """创建站点。同名/同 slug 在租户内不允许重复。"""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="站点名称不能为空")
    # 同名拦截（对用户可读）；slug 由 _unique_slug 保证租户内唯一
    dup = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == tid, models.Site.name == name, models.Site.status != "archived")
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"已存在同名站点「{dup.name}」，请换一个名称")

    site = models.Site(
        id=new_id("site"),
        tenant_id=tid,
        name=name,
        slug=_unique_slug(db, tid, name),
        industry=payload.industry.strip(),
        product_category=payload.product_category.strip(),
        target_markets=list(payload.target_markets or ["en-US"]),
        status="draft",
        template_id=payload.template_id.strip(),
        language=payload.language,
        public_slug=f"s-{tid}-{secrets.token_hex(3)}",
    )
    db.add(site)
    db.flush()

    # 新站点播种默认页面，进入页面编辑器不是一片空白
    seed_site_pages(db, tid, site)

    # 租户现有产品自动关联到新站点（产品是租户级事实，站点复用而非复制）
    products = db.query(models.Product.id).filter(models.Product.tenant_id == tid).all()
    for (product_id,) in products:
        db.add(models.SiteProduct(site_id=site.id, product_id=product_id))

    db.commit()
    db.refresh(site)
    return {"ok": True, "site": site.to_dict()}


@router.get("/{site_id}")
def get_site_endpoint(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    return {"ok": True, "site": _with_counts(db, [site])[0]}


@router.patch("/{site_id}")
def update_site(site_id: str, payload: schemas.SiteUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        name = data["name"].strip()
        if name != site.name:
            dup = (
                db.query(models.Site)
                .filter(
                    models.Site.tenant_id == tid,
                    models.Site.name == name,
                    models.Site.id != site.id,
                    models.Site.status != "archived",
                )
                .first()
            )
            if dup:
                raise HTTPException(status_code=409, detail=f"已存在同名站点「{dup.name}」")
            site.name = name
            site.slug = _unique_slug(db, tid, name, exclude_id=site.id)
    for key in ("industry", "product_category", "template_id"):
        if data.get(key) is not None:
            setattr(site, key, data[key])
    if data.get("target_markets"):
        site.target_markets = list(data["target_markets"])
    if data.get("language"):
        site.language = data["language"]
    if data.get("status"):
        if site.is_default and data["status"] == "archived":
            raise HTTPException(status_code=400, detail="默认站点不可归档（承载存量数据）")
        site.status = data["status"]
        if data["status"] == "published":
            site.publish_count = (site.publish_count or 0) + 1
    db.commit()
    db.refresh(site)
    return {"ok": True, "site": site.to_dict()}


@router.delete("/{site_id}")
def delete_site(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """删除站点：删除其页面与产品关联；询盘是业务记录，保留并解除站点归属。"""
    site = require_site(db, tid, site_id)
    if site.is_default:
        raise HTTPException(status_code=400, detail="默认站点不可删除（承载存量数据）")

    db.query(models.Page).filter(models.Page.site_id == site.id).delete(synchronize_session=False)
    db.query(models.SiteProduct).filter(models.SiteProduct.site_id == site.id).delete(synchronize_session=False)
    for inquiry in db.query(models.Inquiry).filter(models.Inquiry.site_id == site.id).all():
        inquiry.site_id = ""
    for draft in db.query(models.Draft).filter(models.Draft.site_id == site.id).all():
        draft.site_id = ""

    db.delete(site)
    db.commit()
    return {"ok": True, "id": site_id}


# ---------------- 站点 ↔ 产品关联（产品事实租户级，站点复用） ----------------


@router.get("/{site_id}/products")
def list_site_products(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """站点关联的产品列表（产品本体仍是租户级单一事实）。"""
    site = require_site(db, tid, site_id)
    rows = (
        db.query(models.Product, models.SiteProduct.created_at)
        .join(models.SiteProduct, models.SiteProduct.product_id == models.Product.id)
        .filter(models.SiteProduct.site_id == site.id)
        .order_by(models.SiteProduct.created_at.asc())
        .all()
    )
    return {"ok": True, "products": [p.to_dict() for p, _ in rows]}


@router.post("/{site_id}/products", status_code=201)
def link_site_product(
    site_id: str,
    payload: schemas.SiteProductLink,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """把租户产品关联到站点（幂等：重复关联不报错、不重复建行）。"""
    site = require_site(db, tid, site_id)
    product = (
        db.query(models.Product)
        .filter(models.Product.id == payload.product_id, models.Product.tenant_id == tid)
        .first()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="产品不存在")
    exists = (
        db.query(models.SiteProduct)
        .filter(models.SiteProduct.site_id == site.id, models.SiteProduct.product_id == payload.product_id)
        .first()
    )
    if not exists:
        db.add(models.SiteProduct(site_id=site.id, product_id=payload.product_id))
        db.commit()
    return {"ok": True, "site_id": site.id, "product_id": payload.product_id}


@router.delete("/{site_id}/products/{product_id}")
def unlink_site_product(site_id: str, product_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """解除站点与产品的关联（不删除产品本体）。"""
    site = require_site(db, tid, site_id)
    db.query(models.SiteProduct).filter(
        models.SiteProduct.site_id == site.id,
        models.SiteProduct.product_id == product_id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "site_id": site.id, "product_id": product_id}


# ---------------- AI 整站生成（P0-AI-SITE-GENERATION） ----------------


@router.post("/generate", status_code=201)
async def generate_site_full(
    payload: schemas.SiteGenerateRequest,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """产品类别 → 结构化 SiteGenerationPlan → 站点 + 页面 + AI 图片资产。

    免费额度规则（账号级，非站点级）：
    - 免费次数未用 → 本次免费；**生成成功落库后才扣减**（失败不扣）；
    - 免费次数已用 → 套餐必须包含 site.generate（否则 402）。
    """
    import secrets as _secrets

    from .. import market_profiles
    from ..image_provider import get_image_provider
    from ..prompts.image_brief import to_image_prompt
    from ..services import site_generation
    from ..tenancy import singleton

    # 1) 入参校验（失败不消耗任何额度）
    category = payload.product_category.strip()
    if not category:
        raise HTTPException(status_code=422, detail="产品类别不能为空")
    markets = [m for m in payload.target_markets if m in market_profiles.SUPPORTED_MARKETS]
    if not markets:
        raise HTTPException(status_code=422, detail="目标市场无效")

    usage = singleton(db, models.Usage, tid)
    used_free = usage.free_generation_used < usage.free_generation_limit
    if not used_free:
        # 免费额度已用：免费套餐 → 402；付费套餐（starter/growth/expert）继续
        from .. import entitlements

        if entitlements.get_plan_id(db, tid) == "free":
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "免费完整生成次数已用完（账号级 1 次），升级套餐后可继续生成",
                    "feature": "site.generate",
                    "requiredPlan": "starter",
                    "upgradeUrl": entitlements.UPGRADE_URL,
                },
            )

    # 2) 结构化生成（LLM 优先，失败降级模板；Demo 模式下真实模型不可用会明确报错）
    from .. import llm as llm_mod

    try:
        plan = await site_generation.generate_site_plan(
            company_name=payload.company_name.strip(),
            product_category=category,
            product_description=payload.product_description.strip(),
            target_buyer=payload.target_buyer.strip(),
            target_markets=markets,
            preferred_style=payload.preferred_style,
            template_id=payload.template_preference.strip(),
        )
    except llm_mod.AIRealUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # AI 来源标注（glm / template_fallback / template —— 前端如实展示，不冒充）
    ai_runtime = llm_mod.status()
    ai_source = "glm" if plan.get("_source") == "llm" else (
        "template_fallback" if ai_runtime.get("degraded") else "template"
    )
    ai_model = ai_runtime.get("model") or ai_runtime.get("provider") or ""

    site_name = payload.company_name.strip() or f"{category}独立站"
    slug = _unique_slug(db, tid, site_name)
    site = models.Site(
        id=new_id("site"),
        tenant_id=tid,
        name=site_name,
        slug=slug,
        industry=plan["industry_profile"].get("industry_label", ""),
        product_category=category,
        target_markets=markets,
        status="draft",
        template_id=payload.template_preference.strip(),
        public_slug=f"s-{tid}-{_secrets.token_hex(3)}",
    )
    db.add(site)
    db.flush()

    # 3) 站点页面：首页 = plan 的结构决策（编辑器可继续编辑）
    home_sections = site_generation.plan_to_home_sections(plan, site_name)
    presets = [
        ("首页", "/", True, 0, home_sections),
        ("产品中心", "/products", False, 1, home_sections[:3]),
        ("解决方案", "/solutions", False, 2, home_sections[:3]),
        ("案例", "/cases", False, 3, home_sections[:2]),
        ("关于我们", "/about", False, 4, home_sections[:2]),
        ("联系我们", "/contact", False, 5, home_sections[:2]),
    ]
    for name, slug_p, is_home, idx, secs in presets:
        db.add(
            models.Page(
                id=new_id("page"),
                tenant_id=tid,
                site_id=site.id,
                name=name,
                slug=slug_p,
                sections=secs,
                is_home=is_home,
                order_index=idx,
                seo_title=f"{name} | {site_name}",
                seo_description=f"{name} page of {site_name} ({category}).",
            )
        )
    # 租户产品自动关联
    for (pid,) in db.query(models.Product.id).filter(models.Product.tenant_id == tid).all():
        db.add(models.SiteProduct(site_id=site.id, product_id=pid))

    # 4) AI 图片：brief → ImageProvider → Asset（失败给安全 fallback，页面不空白）
    provider = get_image_provider()
    assets: list[dict] = []
    failed = 0
    for b in plan.get("image_briefs", []):
        prompt = to_image_prompt(b, category, b.get("market", markets[0]))
        try:
            res = await provider.generate(
                prompt, market=b.get("market", markets[0]), role=b.get("image_role", ""), subject=category
            )
            note = ""
        except Exception as exc:  # 图像失败不阻断建站
            failed += 1
            from ..image_provider import MockImageProvider

            res = await MockImageProvider().generate(
                prompt, market=b.get("market", markets[0]), role=b.get("image_role", ""), subject=category
            )
            note = f"生成失败已回退占位图：{str(exc)[:80]}"
        asset = models.Asset(
            id=new_id("asset"),
            tenant_id=tid,
            site_id=site.id,
            market=b.get("market", markets[0]),
            section_id=b.get("section_type", ""),
            role=b.get("image_role", ""),
            source_type=res["source_type"],
            provider=res["provider"],
            prompt=prompt,
            url=res["url"],
            note=note,
        )
        db.add(asset)
        assets.append(asset.to_dict())

    # 5) 全部落库成功 → 事务性消耗免费额度（生成失败不会走到这里）
    if used_free:
        usage.free_generation_used += 1

    # PHASE 6：三市场变体真实持久化（每市场独立 layout/tokens/文案/资产清单）
    from ..services.market_variants import generate_variants as _gv

    try:
        variants = await _gv(db, tid, site)
        variants_summary = [
            {"market": v.market, "sections": len(v.layout_schema.get("sections", [])),
             "assets": len(v.asset_manifest)}
            for v in variants
        ]
    except Exception as exc:  # noqa: BLE001 — 变体失败不阻断主站生成
        variants_summary = []
        logger.warning("市场变体生成失败（不阻断主流程）：%s", str(exc)[:150])

    # AI 运行日志落库（capability 级证据链，绝不保存 API Key）
    for ex in llm_mod.drain_executions():
        db.add(
            models.AIExecution(
                id=new_id("ai"),
                tenant_id=tid,
                site_id=site.id,
                capability=ex["capability"],
                provider=ex["provider"],
                model=ex["model"],
                source=ex["source"],
                latency_ms=ex["latency_ms"],
                success=ex["success"],
                error=ex["error"],
            )
        )

    db.commit()
    db.refresh(site)

    return {
        "ok": True,
        "site": site.to_dict(),
        "plan": plan,
        "assets": assets,
        "image_failed": failed,
        "image_note": "部分 AI 图片生成失败，可重新生成" if failed else "",
        "ai_source": ai_source,
        "ai_model": ai_model,
        "ai_note": {
            "glm": "真实 GLM 生成",
            "template_fallback": "真实模型调用失败，本次内容为降级模板生成（已如实标注）",
            "template": "未配置真实模型，本次内容为内置模板生成（已如实标注）",
        }[ai_source],
        "market_variants": variants_summary,
        "free_quota": {"used": usage.free_generation_used, "limit": usage.free_generation_limit},
    }


@router.get("/{site_id}/market-variants")
def list_market_variants(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """PHASE 6:站点的市场变体(每市场独立 layout/tokens/content/资产清单)。"""
    site = require_site(db, tid, site_id)
    rows = (
        db.query(models.SiteMarketVariant)
        .filter(models.SiteMarketVariant.site_id == site.id)
        .order_by(models.SiteMarketVariant.market)
        .all()
    )
    return {"variants": [r.to_dict() for r in rows]}


@router.get("/{site_id}/market-variants/{market}")
def get_market_variant(site_id: str, market: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    site = require_site(db, tid, site_id)
    row = (
        db.query(models.SiteMarketVariant)
        .filter(models.SiteMarketVariant.site_id == site.id, models.SiteMarketVariant.market == market)
        .first()
    )
    if row is None:
        raise HTTPException(404, "该市场变体不存在,请先生成")
    return row.to_dict()


@router.post("/{site_id}/market-variants/generate", status_code=201)
async def generate_market_variants(site_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """(Re)生成三市场变体:Industry → Theme/Layout/Transcreation × 3 市场 → Asset Slot 管线 → 持久化。"""
    from ..services.market_variants import generate_variants

    site = require_site(db, tid, site_id)
    variants = await generate_variants(db, tid, site, regenerate=True)
    return {"ok": True, "variants": [v.to_dict() for v in variants]}


@router.get("/{site_id}/assets")
def list_site_assets(site_id: str, market: str = "", db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """站点视觉资产（含 source_type 溯源：REAL / AI_GENERATED）。"""
    site = require_site(db, tid, site_id)
    q = db.query(models.Asset).filter(models.Asset.site_id == site.id)
    if market:
        q = q.filter(models.Asset.market == market)
    items = q.order_by(models.Asset.created_at.desc()).all()
    return {"ok": True, "assets": [a.to_dict() for a in items]}


class VisualsRegenerateRequest(BaseModel):
    market: str = ""
    role: str = ""


@router.post("/{site_id}/visuals/regenerate")
async def regenerate_visuals(
    site_id: str,
    payload: VisualsRegenerateRequest,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    """只重新生成 FALLBACK 的图片(限流恢复后一键补齐)。"""
    from ..image_provider import get_image_provider
    from ..services.market_variants import SECTION_TO_SLOT
    from ..knowledge import match_industry

    site = require_site(db, tid, site_id)
    provider = get_image_provider()

    # 找 FALLBACK 的 manifest 条目
    variants = (
        db.query(models.SiteMarketVariant)
        .filter(models.SiteMarketVariant.site_id == site.id)
        .all()
    )
    regenerated = 0
    still_fallback = 0
    results = []

    for v in variants:
        if payload.market and v.market != payload.market:
            continue
        manifest = v.asset_manifest or {}
        sections = (v.layout_schema or {}).get("sections", [])

        for slot, info in manifest.items():
            if info.get("source_type") != "FALLBACK":
                continue
            if payload.role and slot != payload.role:
                continue
            # 跳过事实性禁止项
            if slot in ("case", "certification", "customer_logo", "factory_evidence",
                        "product_label", "spec_plate", "case_real"):
                continue

            # 从 brief 获取 prompt(简化:用 slot + category)
            prompt = f"{site.product_category} | {slot.replace('_', ' ')} | professional B2B industrial photography"
            try:
                res = await provider.generate(
                    prompt=prompt, market=v.market, role=slot,
                    subject=site.product_category)
                if res.get("url"):
                    manifest[slot] = {"source_type": "AI_GENERATED", "url": res["url"],
                                      "provider": res.get("provider", ""),
                                      "regenerated": True}
                    db.add(models.Asset(
                        id=new_id("asset"), tenant_id=tid, site_id=site.id,
                        market=v.market, section_id=slot, role=slot,
                        source_type="AI_GENERATED", provider=res.get("provider", ""),
                        prompt=prompt[:500], url=res["url"],
                    ))
                    regenerated += 1
                    results.append({"market": v.market, "slot": slot, "status": "AI_GENERATED"})
                else:
                    still_fallback += 1
                    results.append({"market": v.market, "slot": slot, "status": "still_fallback"})
            except Exception as exc:
                still_fallback += 1
                results.append({"market": v.market, "slot": slot,
                                "status": "error", "error": str(exc)[:80]})

        # 注入 URL 到 section props
        for s in sections:
            sec_type = s.get("type", "")
            slot = SECTION_TO_SLOT.get(sec_type, sec_type)
            hit = manifest.get(slot) if slot else None
            if not hit and sec_type == "hero":
                hit = manifest.get("hero")
            if hit and hit.get("url"):
                s["props"] = {**s.get("props", {}), "image": hit["url"],
                              "image_source": hit.get("source_type", "")}

        v.asset_manifest = manifest
        v.layout_schema = {"sections": sections,
                           "layout_source": (v.layout_schema or {}).get("layout_source", "template")}

    db.commit()
    return {"ok": True, "regenerated": regenerated, "still_fallback": still_fallback, "results": results}
