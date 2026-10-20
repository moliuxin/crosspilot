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


# ---------------------------------------------------------------------------
# 样式意图解析（确定性规则，零 LLM）：字体颜色/大小类指令不进模型，
# 直接解析为 props.style 补丁 —— 防止 GLM 把"变成紫色"当成正文写进标题。
# ---------------------------------------------------------------------------
_STYLE_COLORS = {
    "紫": "#7c3aed", "蓝": "#2563eb", "红": "#dc2626", "绿": "#16a34a",
    "金": "#d4a017", "橙": "#ea580c", "粉": "#ec4899", "黑": "#111827",
    "白": "#ffffff", "灰": "#6b7280", "青": "#0891b2", "黄": "#ca8a04",
    "purple": "#7c3aed", "blue": "#2563eb", "red": "#dc2626", "green": "#16a34a",
    "gold": "#d4a017", "orange": "#ea580c", "pink": "#ec4899",
    "black": "#111827", "white": "#ffffff", "gray": "#6b7280", "grey": "#6b7280",
}
_COLOR_RE = "(?:字体|文字|标题|描述|正文|颜色)?(?:变成|变为|改为|改成|换成|设为|设置成|调成|用)?\\s*([A-Za-z]{4,6}|[\\u4e00-\\u9fa5])色"
_SIZE_UP = "(?:字体|文字|标题|描述|正文)?(?:变大|大一点|大一些|加大|调大|更大|再大)(?:一点|一些|些)?"
_SIZE_DOWN = "(?:字体|文字|标题|描述|正文)?(?:变小|小一点|小一些|缩小|调小|更小|再小)(?:一点|一些|些)?"


def parse_style_intent(instruction: str) -> tuple[dict, str, list[str]]:
    """从指令中解析样式意图 → (style 更新, 剥离样式后的剩余指令, 可读标签)。

    剩余指令为空说明是纯样式修改 —— 调用方可直接走规则补丁，完全不调 LLM。
    """
    import re as _re

    text = instruction or ""
    updates: dict = {}
    labels: list[str] = []
    consumed: list[tuple[int, int]] = []

    for m in _re.finditer(_COLOR_RE, text):
        key = m.group(1).lower()
        hexv = _STYLE_COLORS.get(key) or _STYLE_COLORS.get(key[:1])
        if not hexv:
            continue
        # 目标:提到 描述/正文 → 描述色;否则默认标题色
        target = "desc_color" if ("描述" in m.group(0) or "正文" in m.group(0)) else "title_color"
        updates[target] = hexv
        labels.append(f"{'描述' if target == 'desc_color' else '标题'}颜色 {key}色({hexv})")
        consumed.append(m.span())

    scale = 1.0
    if _re.search(_SIZE_UP, text):
        scale = 1.18
    if _re.search(_SIZE_DOWN, text):
        scale = 0.85
    if scale != 1.0:
        target = "desc_scale" if ("描述" in text or "正文" in text) else "title_scale"
        updates[target] = scale
        labels.append(f"{'描述' if target == 'desc_scale' else '标题'}字号 ×{scale}")
        m = _re.search(_SIZE_UP if scale > 1 else _SIZE_DOWN, text)
        if m:
            consumed.append(m.span())

    residual = text
    for start, end in sorted(consumed, reverse=True):
        residual = residual[:start] + residual[end:]
    residual = _re.sub(r"^[，,。；;、\s]+|[，,。；;、\s]+$", "", residual)
    return updates, residual, labels



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
    # Freehand AI Brush 圈选数据(可选):selection_mode(freehand/rectangle)/
    # polygon_points/bounding_box/section_hint —— lasso 决定受影响区块
    selection: dict = {}


@router.post("/generate", status_code=201)
async def brush_generate(payload: BrushGenerateRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """AI 画笔真生成：变体区块 + 自然语言 → JSON Patch → Draft（绝不直接 Publish）。

    Freehand 圈选：payload.selection.section_hint(圈选重叠最大的区块 id)优先于
    section_id —— 用户手绘圈了哪块就改哪块;圈选元数据随 Draft 落库可追溯。
    """
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
    target_id = payload.section_id
    selection = dict(payload.selection or {})
    hint = str(selection.get("section_hint") or "").strip()
    if hint:
        hinted = next((s for s in sections if s.get("id") == hint), None)
        if hinted is None:
            raise HTTPException(status_code=404, detail=f"圈选命中的区块 {hint} 不存在")
        target_id = hint  # 圈选裁决:手绘选区优先
    sec = next((s for s in sections if s.get("id") == target_id), None)
    if sec is None:
        raise HTTPException(status_code=404, detail=f"区块 {target_id} 不存在")

    facts = {p.id: {"name": p.name, "model": p.model, "specs": p.specs}
             for p in db.query(models.Product).filter(models.Product.tenant_id == tid).all()}
    mk = market_knowledge(payload.market)
    cta_allowed = (mk.get("cta", {}).get("primary", []) + mk.get("cta", {}).get("secondary", []))

    # 样式意图优先(确定性规则):颜色/字号指令直接变成 props.style,不进模型 ——
    # 否则 GLM 会把"字体变成紫色"当成正文写进标题
    style_updates, residual, style_labels = parse_style_intent(payload.instruction)
    content_instruction = residual.strip()
    # 残片≤2字(如"一点")视为量化词碎屑,纯样式处理;否则才进入内容改写
    style_only = bool(style_updates) and len(content_instruction) <= 2

    if style_only:
        new_props = dict(sec.get("props") or {})
        merged_style = {**(new_props.get("style") or {}), **style_updates}
        new_props["style"] = merged_style
        ai_source, model_name = "rule", ""
    else:
        system = (
            "你是B2B独立站的内容改写引擎。只输出JSON补丁(props对象),不输出HTML。"
            "禁止编造Product Facts(参数/认证/交期),禁止电商话术(Buy Now/Cart/Checkout)。"
            "CTA只允许从:" + " / ".join(cta_allowed[:8]) + " 中选择。"
        )
        user_msg = (
            f"市场:{payload.market};行业:{site.product_category};区块:{sec.get('type')};"
            f"圈选模式:{selection.get('selection_mode') or 'section-click'};"
            f"当前props:{json.dumps(sec.get('props', {}), ensure_ascii=False)};"
            f"产品事实(只读):{json.dumps(list(facts.values())[:3], ensure_ascii=False)};"
            f"修改要求:{content_instruction}"
        )
        result = await llm.complete_json(system, user_msg,
                                         capability="brush_generate", schema_keys=["props"])
        if result and isinstance(result.get("props"), dict):
            new_props = dict(result["props"])
            ai_source, model_name = "glm", result.get("_ai_model", "")
        else:
            primary = (mk.get("cta", {}).get("primary") or ["Request a quote"])[0]
            new_props = {
                "title": f"{site.product_category} — {content_instruction[:40]}",
                "description": content_instruction[:120],
                "cta": primary,
            }
            ai_source, model_name = "template", ""
        if style_updates:
            new_props["style"] = {**(new_props.get("style") or {}), **style_updates}

    old_props = sec.get("props") or {}
    old_style = old_props.get("style") or {}
    # 圈选改文案不得误删已生成的图片:AI/模板未提供 image 时保留原值
    for keep in ("image", "image_source"):
        if keep in old_props and not new_props.get(keep):
            new_props[keep] = old_props[keep]
    diff = [{"field": k, "before": old_props.get(k, ""), "after": new_props.get(k, "")}
            for k in {**old_props, **new_props}
            if k != "style" and old_props.get(k, "") != new_props.get(k, "")]
    # 样式变更追加可读 diff 行(样式键合并进 style,不逐键出现在顶层 diff)
    if style_updates:
        before_txt = " ".join(f"{k}={old_style.get(k, '—')}" for k in style_updates)
        after_txt = " ".join(f"{k}={style_updates[k]}" for k in style_updates)
        diff.append({"field": "样式(字体颜色/字号)", "before": before_txt, "after": after_txt})

    # 圈选元数据落库(spec 5.3):只描述用户圈了哪,不参与发布补丁
    selection.update({
        "section_hint": target_id,
        "market": payload.market,
        "site_id": site.id,
    })

    draft = models.Draft(
        id=new_id("draft"), tenant_id=tid, site_id=site.id,
        title=f"AI 画笔 · {payload.market} {sec.get('type')}",
        entity_type="market_variant", entity_id=variant.id,
        market=payload.market,
        diff=diff,
        patch={"sections": {target_id: {"props": new_props}}},
        selection=selection,
        status="pending",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {
        "ok": True, "draft_id": draft.id, "ai_source": ai_source, "model": model_name,
        "section": {"id": target_id, "type": sec.get("type")},
        "selection": selection,
        "diff": diff, "market": payload.market,
        "note": "草稿已生成，确认发布后才会写入公开变体（人工确认硬约束）",
    }
