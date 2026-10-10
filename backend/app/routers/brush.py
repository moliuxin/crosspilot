"""AI 画笔（brush）端点 —— 付费能力 brush.edit 的后端硬校验。

产品规则（P0-ENTITLEMENT / 指令第十四节）：
- 免费用户**看得到**入口（前端不隐藏按钮），但使用必须先升级；
- 前端锁只是展示，后端必须再次校验 —— 直接调 API 的免费账户一律 403；
- 有 entitlement（growth 套餐或单独开通）后才允许生成 Draft。
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import scoped_get_or_none

router = APIRouter(prefix="/brush", tags=["brush"])


@router.post("/preview")
async def brush_preview(payload: schemas.BrushPreviewRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """AI 画笔预览：无权限账户 403（后端硬校验，不依赖前端锁）。"""
    if not entitlements.has_feature(db, tid, "brush.edit"):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "AI 画笔属于 Pro 能力，升级后即可在页面编辑器中圈选并让 AI 修改内容。",
                "feature": "brush.edit",
                "requiredPlan": entitlements.required_plan_for("brush.edit"),
                "upgradeUrl": entitlements.UPGRADE_URL,
            },
        )

    page = scoped_get_or_none(db, models.Page, payload.page_id, tid)
    if page is None:
        raise HTTPException(status_code=404, detail="页面不存在")

    # 画笔交互本体（圈选 + 视觉 Diff）属后续迭代；当前返回能力开通确认 + 页面区块清单
    return {
        "ok": True,
        "page_id": page.id,
        "sections": [{"id": s.get("id"), "label": s.get("label")} for s in (page.sections or [])],
        "note": "AI 画笔已开通：圈选页面内容并自然语言修改，所有改动走 Draft → Diff → 人工确认。",
    }


class BrushGenerateRequest(BaseModel):
    site_id: str
    market: str
    section_id: str
    instruction: str


@router.post("/generate", status_code=201)
async def brush_generate(payload: BrushGenerateRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """AI 画笔真生成：变体区块 + 自然语言 → JSON Patch → Draft（绝不直接 Publish）。"""
    if not entitlements.has_feature(db, tid, "brush.edit"):
        raise HTTPException(status_code=403, detail={
            "message": "AI 画笔属于 Pro 能力，升级后即可圈选组件并让 AI 修改内容。",
            "feature": "brush.edit",
            "requiredPlan": entitlements.required_plan_for("brush.edit"),
            "upgradeUrl": entitlements.UPGRADE_URL,
        })
    from ..tenancy import require_site
    from ..utils import new_id
    from .. import llm
    from ..knowledge import market_knowledge

    site = require_site(db, tid, payload.site_id)
    variant = (db.query(models.SiteMarketVariant)
               .filter(models.SiteMarketVariant.site_id == site.id,
                       models.SiteMarketVariant.market == payload.market)
               .first())
    if variant is None:
        raise HTTPException(status_code=404, detail="该市场变体不存在，请先生成")
    sections = (variant.layout_schema or {}).get("sections", [])
    sec = next((s for s in sections if s.get("id") == payload.section_id), None)
    if sec is None:
        raise HTTPException(status_code=404, detail=f"区块 {payload.section_id} 不存在")

    facts = {p.id: {"name": p.name, "model": p.model, "specs": p.specs}
             for p in db.query(models.Product).filter(models.Product.tenant_id == tid).all()}
    mk = market_knowledge(payload.market)
    cta_allowed = (mk.get("cta", {}).get("primary", []) + mk.get("cta", {}).get("secondary", []))

    system = (
        "你是B2B独立站的内容改写引擎。只输出JSON补丁(props对象),不输出HTML。"
        "禁止编造Product Facts(参数/认证/交期),禁止电商话术(Buy Now/Cart/Checkout)。"
        "CTA只允许从:" + " / ".join(cta_allowed[:8]) + " 中选择。"
    )
    user_msg = (
        f"市场:{payload.market};行业:{site.product_category};区块:{sec.get('type')};"
        f"当前props:{json.dumps(sec.get('props', {}), ensure_ascii=False)};"
        f"产品事实(只读):{json.dumps(list(facts.values())[:3], ensure_ascii=False)};"
        f"修改要求:{payload.instruction}"
    )
    result = await llm.complete_json(system, user_msg,
                                     capability="brush_generate", schema_keys=["props"])
    if result and isinstance(result.get("props"), dict):
        new_props = dict(result["props"])
        ai_source, model_name = "glm", result.get("_ai_model", "")
    else:
        primary = (mk.get("cta", {}).get("primary") or ["Request a quote"])[0]
        new_props = {
            "title": f"{site.product_category} — {payload.instruction[:40]}",
            "description": payload.instruction[:120],
            "cta": primary,
        }
        ai_source, model_name = "template", ""

    old_props = sec.get("props") or {}
    diff = [{"field": k, "before": old_props.get(k, ""), "after": new_props.get(k, "")}
            for k in {**old_props, **new_props} if old_props.get(k, "") != new_props.get(k, "")]

    draft = models.Draft(
        id=new_id("draft"), tenant_id=tid, site_id=site.id,
        title=f"AI 画笔 · {payload.market} {sec.get('type')}",
        entity_type="market_variant", entity_id=variant.id,
        market=payload.market,
        diff=diff,
        patch={"sections": {payload.section_id: {"props": new_props}}},
        status="pending",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {
        "ok": True, "draft_id": draft.id, "ai_source": ai_source, "model": model_name,
        "section": {"id": payload.section_id, "type": sec.get("type")},
        "diff": diff, "market": payload.market,
        "note": "草稿已生成，确认发布后才会写入公开变体（人工确认硬约束）",
    }
