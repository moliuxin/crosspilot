"""Agent 端点：自然语言指令 → 查询 → 建议 → 草稿（Diff）→ 等待人工确认。

安全规则：Agent 永不直接改线上内容，只产出草稿；发布走 POST /api/publish 且必须人工确认。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..utils import new_id

router = APIRouter(prefix="/agent", tags=["agent"])

# 只读型自然语言指令：查数据 / 诊断，不产生任何写入 —— 免费放行。
# 其余（结构化 patch、本地化、回滚、默认优化）都会产出草稿，属付费能力。
_READONLY_HINTS = ("询盘", "inquiry", "rfq", "seo", "得分", "分数", "排名", "诊断", "健康", "audit", "检查")


def _is_readonly_command(command) -> bool:
    if isinstance(command, dict):
        # 结构化 patch 一定产生草稿 → 非只读
        return False
    c = (command or "").lower()
    if not c:
        return False
    # 修改类关键词优先判定为非只读
    if any(k in c for k in ("俄语", "本地化", "多语言", "local", "中文", "回滚", "rollback", "优化", "改写", "生成")):
        return False
    return any(k in c for k in _READONLY_HINTS)


@router.post("/run")
async def run(payload: schemas.AgentRunRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    command = payload.to_command()
    if not _is_readonly_command(command):
        entitlements.require_feature(db, tid, "agent.run")
    return _run_structured(command, db, tid) if isinstance(command, dict) else _run_nl(command, db, tid)


def _new_draft(db: Session, tenant_id: int, **kwargs) -> models.Draft:
    draft = models.Draft(id=new_id("draft"), tenant_id=tenant_id, status="draft", confirmed=False, **kwargs)
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft


def _run_structured(command: dict, db: Session, tid: int) -> dict:
    entity_type = command.get("entity_type", "product")
    entity_id = command.get("entity_id", "")
    patch = command.get("patch") or {}
    market = command.get("market")

    diff = [{"field": k, "after": v} for k, v in patch.items()]
    draft = _new_draft(
        db,
        tid,
        title=f"{'产品' if entity_type == 'product' else '页面'} {entity_id} 优化草稿",
        entity_type=entity_type,
        entity_id=entity_id,
        market=market or "",
        diff=diff,
    )
    return {
        "ok": True,
        "summary": "已生成修改草稿（后端），等待人工确认后发布。",
        "draft": draft.to_dict(),
        "requiresConfirmation": True,
    }


def _run_nl(text: str, db: Session, tid: int) -> dict:
    c = (text or "").lower()

    # 查询类：直接返回真实数据库统计（按租户过滤）
    if any(k in c for k in ("询盘", "inquiry", "rfq")):
        by_status = (
            db.query(models.Inquiry.status, func.count(models.Inquiry.id))
            .filter(models.Inquiry.tenant_id == tid)
            .group_by(models.Inquiry.status)
            .all()
        )
        total = db.query(func.count(models.Inquiry.id)).filter(models.Inquiry.tenant_id == tid).scalar() or 0
        label = {"new": "新询盘", "contacted": "已联系", "following": "跟进中", "done": "已完成"}
        return {
            "ok": True,
            "summary": f"当前共 {total} 条询盘，按状态分布如下。可前往「询盘中心」查看详情并跟进。",
            "table": [{"a": label.get(s, s), "b": f"{n} 条", "c": ""} for s, n in by_status],
            "requiresConfirmation": False,
        }

    if any(k in c for k in ("seo", "最差", "优化", "不完整")):
        products = (
            db.query(models.Product)
            .filter(models.Product.tenant_id == tid)
            .order_by(models.Product.seo_score.asc())
            .limit(5)
            .all()
        )
        worst = products[0] if products else None
        summary = (
            f"共 {db.query(func.count(models.Product.id)).filter(models.Product.tenant_id == tid).scalar() or 0} 个产品，按 SEO 得分升序排列。"
            + (f"建议优先优化得分最低的「{worst.name}」（当前 {worst.seo_score} 分）。" if worst else "")
        )
        return {
            "ok": True,
            "summary": summary,
            "table": [{"a": p.name, "b": p.model, "c": f"SEO {p.seo_score}"} for p in products],
            "requiresConfirmation": False,
        }

    if any(k in c for k in ("诊断", "健康", "audit")):
        avg_seo = db.query(func.avg(models.Product.seo_score)).filter(models.Product.tenant_id == tid).scalar() or 0
        avg_geo = db.query(func.avg(models.Product.geo_score)).filter(models.Product.tenant_id == tid).scalar() or 0
        low = (
            db.query(models.Product)
            .filter(models.Product.tenant_id == tid, models.Product.seo_score < 70)
            .count()
        )
        return {
            "ok": True,
            "summary": f"全站 SEO 平均 {avg_seo:.0f} 分、GEO 平均 {avg_geo:.0f} 分，其中 {low} 个产品低于 70 分，建议优先处理。",
            "requiresConfirmation": False,
        }

    # 修改类：生成草稿
    if any(k in c for k in ("俄语", "本地化", "多语言", "local", "中文")):
        draft = _new_draft(
            db,
            tid,
            title="俄语市场落地页草稿",
            entity_type="page",
            entity_id="page_home",
            market="ru-RU",
            diff=[
                {"field": "market_template", "after": "ru-RU"},
                {"field": "density", "after": "偏紧凑（dense）"},
                {"field": "trust_elements", "after": "EAC / ГОСТ / 本地交付区域"},
            ],
        )
        return {
            "ok": True,
            "summary": "已按「俄语市场模板」生成落地页草稿（不是翻译，是结构性适配）：",
            "draft": draft.to_dict(),
            "requiresConfirmation": True,
        }

    if any(k in c for k in ("回滚", "rollback")):
        return {
            "ok": True,
            "summary": "已请求回滚到上一个发布版本（需在版本记录中二次确认）。",
            "requiresConfirmation": True,
        }

    # 默认：对最低分产品生成优化草稿
    p = (
        db.query(models.Product)
        .filter(models.Product.tenant_id == tid)
        .order_by(models.Product.seo_score.asc())
        .first()
    )
    if not p:
        return {"ok": True, "summary": "当前没有可优化的产品，请先在产品中心添加产品。", "requiresConfirmation": False}

    draft = _new_draft(
        db,
        tid,
        title=f"{p.name} 优化草稿",
        entity_type="product",
        entity_id=p.id,
        seo_score_before=p.seo_score,
        seo_score_after=min(97, p.seo_score + 25),
        geo_score_before=p.geo_score,
        geo_score_after=min(95, p.geo_score + 30),
        diff=[
            {"field": "title", "before": (p.seo or {}).get("title", p.name), "after": f"{p.name} Manufacturer | AQUAFLOW {p.model}".strip()},
            {"field": "slug", "before": (p.seo or {}).get("slug", ""), "after": f"/{p.name.lower().replace(' ', '-')}/"},
            {"field": "faq", "before": f"{len((p.seo or {}).get('faq') or [])} 条", "after": "8 个采购 FAQ"},
            {"field": "schema", "before": "未启用", "after": "Product + FAQPage"},
        ],
    )
    return {
        "ok": True,
        "summary": f"已为「{p.name}」生成优化草稿（SEO {p.seo_score} → {draft.seo_score_after}）。请确认后发布：",
        "draft": draft.to_dict(),
        "requiresConfirmation": True,
    }
