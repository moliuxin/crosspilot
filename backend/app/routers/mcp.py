"""MCP / Tool 层清单（服务端单一真源）。

前端 ``src/services/mcp.js`` 是「工具注册表 + 调用实现」，本端点把**工具清单**
放到服务端，避免前后端各写一份导致漂移，也让「真实 Tool 层」在服务端可被验收。

安全约束（对总指令「AI 不能直接覆盖线上站点」的落实）：
``update_page`` / ``update_product`` 的语义是**产出 Draft**（经 Diff + 人工确认
才能发布），不是直接写库 —— 本清单里的 ``mutates`` 字段明确标注了这点。
"""
from fastapi import APIRouter, Depends

from .. import models
from ..security import current_user

router = APIRouter(prefix="/mcp", tags=["mcp"])

# name / input / output / paid_feature(null=免费) / mutates
TOOLS: list[dict] = [
    # --- 读工具 ---
    {
        "name": "get_site",
        "input": {"market": "string?"},
        "output": {"site": "SiteState", "localization": "Market[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_site_pages",
        "input": {"market": "string?"},
        "output": {"pages": "Page[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_products",
        "input": {"market": "string?", "query": "string?", "limit": "number?"},
        "output": {"products": "Product[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_product_detail",
        "input": {"product_id": "string"},
        "output": {"product": "Product"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_inquiries",
        "input": {"date_from": "string?", "date_to": "string?", "status": "string?"},
        "output": {"inquiries": "Inquiry[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_seo_metrics",
        "input": {"page_id": "string?", "product_id": "string?"},
        "output": {"score": "number", "issues": "SEOIssue[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_geo_metrics",
        "input": {"page_id": "string?", "product_id": "string?"},
        "output": {"geo_score": "number", "signals": "object"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_language_versions",
        "input": {"entity_type": "page|product", "entity_id": "string"},
        "output": {"versions": "LocalizedVersion[]"},
        "paid_feature": None,
        "mutates": False,
    },
    {
        "name": "get_versions",
        "input": {"entity_type": "string?", "entity_id": "string?", "limit": "number?"},
        "output": {"versions": "Version[]"},
        "paid_feature": None,
        "mutates": False,
    },
    # --- 写工具（一律产出 Draft，不直接改线上数据） ---
    {
        "name": "create_draft",
        "input": {"entity_type": "page|product", "entity_id": "string", "patch": "object"},
        "output": {"draft_id": "string", "diff": "Diff[]"},
        "paid_feature": "agent.run",
        "mutates": "draft",
    },
    {
        "name": "update_draft",
        "input": {"entity_type": "page|product", "entity_id": "string", "patch": "object"},
        "output": {"draft_id": "string", "diff": "Diff[]"},
        "paid_feature": "agent.run",
        "mutates": "draft",
    },
    {
        "name": "update_page",
        "input": {"page_id": "string", "patch": "object"},
        "output": {"draft_id": "string", "diff": "Diff[]"},
        "paid_feature": "agent.run",
        "mutates": "draft",
    },
    {
        "name": "update_product",
        "input": {"product_id": "string", "patch": "object"},
        "output": {"draft_id": "string", "diff": "Diff[]"},
        "paid_feature": "agent.run",
        "mutates": "draft",
    },
    {
        "name": "publish_page",
        "input": {"draft_id": "string", "human_confirmed": True},
        "output": {"published": "boolean", "version": "string"},
        "paid_feature": "site.publish",
        "mutates": "publish",
    },
    {
        "name": "rollback_version",
        "input": {"entity_type": "page|product", "entity_id": "string", "version_id": "string?"},
        "output": {"rolled_back": "boolean", "version": "object"},
        "paid_feature": None,
        "mutates": "rollback",
    },
]


@router.get("/tools")
def list_tools(user: models.User = Depends(current_user)):
    """返回全部工具（当前 15 个：11 读 + 4 写；其中 create_draft 与 update_draft 同源）。"""
    return {"ok": True, "count": len(TOOLS), "tools": TOOLS}
