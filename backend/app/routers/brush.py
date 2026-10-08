"""AI 画笔（brush）端点 —— 付费能力 brush.edit 的后端硬校验。

产品规则（P0-ENTITLEMENT / 指令第十四节）：
- 免费用户**看得到**入口（前端不隐藏按钮），但使用必须先升级；
- 前端锁只是展示，后端必须再次校验 —— 直接调 API 的免费账户一律 403；
- 有 entitlement（growth 套餐或单独开通）后才允许生成 Draft。
"""
from fastapi import APIRouter, Depends, HTTPException
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
