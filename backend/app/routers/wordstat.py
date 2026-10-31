"""商机 BI · Wordstat 数据接入路由。

工作流（诚实数据链路）：
1. 营销人员在 Yandex Wordstat Web 界面导出 CSV（Wordstat 官方导出口）；
2. 本接口解析 → 采购意图分层（规则）→ 词形族聚合 → 落库；
3. 前端 BI 大屏读取数据集做可视化（机会矩阵 / 意图浓度 / 地图）。

在线抓取为适配器形态：网络可达 Yandex 的部署环境可启用，
境内网络被地理屏蔽时返回真实失败原因（不伪造数据）。
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import WordstatDataset
from ..security import tenant_scope
from ..services import wordstat as ws

router = APIRouter(prefix="/growth/wordstat", tags=["growth-bi"])


class ImportRequest(BaseModel):
    label: str = Field(default="", max_length=100)
    content: str = Field(min_length=5, max_length=400_000)
    source: str = Field(default="imported", pattern="^(imported|bukvarix|wordstat)$")
    # 逐月历史（可选）：{关键词: [近12个月搜索量...]} + 月份标签，来自 Wordstat「История запроса」
    trends: dict[str, list[float]] = Field(default_factory=dict)
    trend_months: list[str] = Field(default_factory=list)


@router.post("/import")
def import_dataset(
    payload: ImportRequest,
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
):
    rows = ws.parse_wordstat_export(payload.content)
    if not rows:
        raise HTTPException(
            status_code=422,
            detail="未能解析出任何关键词行。请确认粘贴的是 Wordstat 导出内容（关键词<TAB>搜索量，每行一条）。",
        )
    enriched = ws.enrich_dataset(rows)
    # 逐月历史注入（真实 Wordstat 历史，非演示序列）
    trends = {k: v for k, v in (payload.trends or {}).items() if v}
    if trends:
        for k in enriched["keywords"]:
            if k["kw"] in trends:
                k["trend"] = trends[k["kw"]]
                k["trend_source"] = "wordstat_history"
        enriched["trend_months"] = payload.trend_months or []
        enriched["trend_source"] = "wordstat_history"
    label = (payload.label or "").strip() or f"导入数据集 {rows[0]['kw'][:24]}"
    ds = WordstatDataset(
        id=f"ws-{secrets.token_hex(5)}",
        tenant_id=tid,
        label=label,
        source=payload.source,
        payload={"keywords": enriched["keywords"], "metrics": enriched["metrics"]},
    )
    db.add(ds)
    db.commit()
    return {
        "id": ds.id,
        "label": ds.label,
        "source": ds.source,
        "note": "竞争度：导入数据未附时按搜索量分位代理（comp_source=volume_rank_proxy），非 SERP 实测。",
        **enriched,
    }


@router.get("/datasets")
def list_datasets(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    rows = (
        db.query(WordstatDataset)
        .filter(WordstatDataset.tenant_id == tid)
        .order_by(WordstatDataset.created_at.desc())
        .limit(50)
        .all()
    )
    return [r.to_dict() for r in rows]


@router.get("/datasets/{ds_id}")
def get_dataset(ds_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    ds = (
        db.query(WordstatDataset)
        .filter(WordstatDataset.id == ds_id, WordstatDataset.tenant_id == tid)
        .first()
    )
    if not ds:
        raise HTTPException(status_code=404, detail="数据集不存在")
    return {"id": ds.id, "label": ds.label, "source": ds.source, **(ds.payload or {})}


class LiveRequest(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)


@router.post("/live")
async def live_probe(payload: LiveRequest, _tid: int = Depends(tenant_scope)):
    """在线抓取探测：连通即报告可启用；被屏蔽则返回真实原因与替代工作流。"""
    return await ws.try_live_fetch(payload.keyword)


class FetchRequest(BaseModel):
    seeds: list[str] = Field(min_length=1, max_length=8)
    label: str = Field(default="", max_length=100)
    num_per_seed: int = Field(default=20, ge=5, le=40)


@router.post("/fetch")
async def fetch_real(payload: FetchRequest, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """一键拉取 Bukvarix（Wordstat 库）真实数据：种子词 → 相关词+真实频次 → 落库。

    服务器出口无法直达 Bukvarix（境内/数据中心 IP 常被拒）时返回真实失败，
    请改用：本地脚本 fetch_bukvarix.mjs 拉取后走 /import（source=bukvarix）。
    """
    all_rows: dict[str, dict] = {}
    errors: list[str] = []
    for seed in payload.seeds[:8]:
        try:
            rows = await ws.fetch_bukvarix(seed, num=payload.num_per_seed)
            for r in rows:
                if r["vol"] > 0 and r["kw"] not in all_rows:
                    all_rows[r["kw"]] = r
        except Exception as exc:  # 单个种子失败不阻塞
            errors.append(f"{seed}: {exc}")
    if not all_rows:
        raise HTTPException(
            status_code=502,
            detail=f"实时拉取失败（{'；'.join(errors) or '无返回'}）。请用本地脚本 fetch_bukvarix.mjs 拉取后走 /import。",
        )
    ranked = sorted(all_rows.values(), key=lambda r: r["vol"], reverse=True)[:40]
    enriched = ws.enrich_dataset(ranked)
    label = (payload.label or "").strip() or f"真实数据 · {payload.seeds[0][:24]}"
    ds = WordstatDataset(
        id=f"ws-{secrets.token_hex(5)}",
        tenant_id=tid,
        label=label,
        source="bukvarix",
        payload={"keywords": enriched["keywords"], "metrics": enriched["metrics"]},
    )
    db.add(ds)
    db.commit()
    return {
        "id": ds.id,
        "label": ds.label,
        "source": "bukvarix",
        "seeds_ok": len(payload.seeds) - len(errors),
        "errors": errors,
        "note": "数据口径：Yandex Wordstat 库（经 Bukvarix API，区域=Весь мир），近期月度频次；竞争度为搜索量分位代理。",
        **enriched,
    }
