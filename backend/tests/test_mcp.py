"""MCP / Tool 层测试。

总指令要求「真实 MCP/Tool 层」，工具的清单与语义必须在服务端可验收：
- 清单端点返回 15 个工具（11 读 + 4 写）
- 前后端工具名必须一一对应（服务端是单一真源，前端是调用实现）
- update_page / update_product 的语义是**产 Draft**，不是直接改库
  （AI 不得直接覆盖线上站点）
"""
import re
from pathlib import Path

from app import models

BASE = "/api"
REQUIRED = {
    "get_site",
    "get_site_pages",
    "get_products",
    "get_product_detail",
    "get_inquiries",
    "get_seo_metrics",
    "get_geo_metrics",
    "get_language_versions",
    "get_versions",
    "create_draft",
    "update_draft",
    "update_page",
    "update_product",
    "publish_page",
    "rollback_version",
}
# 本轮从 9 个扩到 15 个（11 读 + 4 写）：原来的 9 个全在，新增 6 个
NEW_TOOLS = {"get_site", "get_geo_metrics", "get_versions", "create_draft", "update_page", "update_product"}

# 前端工具注册表（仓库根 src/services/mcp.js）
MCP_JS = Path(__file__).resolve().parents[2] / "src" / "services" / "mcp.js"


def test_mcp_tools_endpoint_requires_login(anon_client):
    assert anon_client.get(f"{BASE}/mcp/tools").status_code == 401


def test_mcp_tools_lists_all(client):
    r = client.get(f"{BASE}/mcp/tools")
    assert r.status_code == 200
    d = r.json()
    names = {t["name"] for t in d["tools"]}
    assert REQUIRED <= names, f"缺少工具：{REQUIRED - names}"
    assert d["count"] == len(d["tools"]) >= 14


def test_mcp_tools_contains_new_six(client):
    names = {t["name"] for t in client.get(f"{BASE}/mcp/tools").json()["tools"]}
    assert NEW_TOOLS <= names


def test_mcp_tools_shape(client):
    tools = client.get(f"{BASE}/mcp/tools").json()["tools"]
    for t in tools:
        assert t["name"]
        assert "input" in t and "output" in t
        assert "mutates" in t
        assert "paid_feature" in t


def test_write_tools_mutate_draft_not_directly(client):
    """写工具的语义必须是产 Draft —— AI 不能直接覆盖线上内容。"""
    tools = {t["name"]: t for t in client.get(f"{BASE}/mcp/tools").json()["tools"]}
    for name in ("create_draft", "update_draft", "update_page", "update_product"):
        assert tools[name]["mutates"] == "draft", f"{name} 不应直接改库"
    assert tools["publish_page"]["mutates"] == "publish"
    assert tools["rollback_version"]["mutates"] == "rollback"


def test_read_tools_declare_no_mutation(client):
    tools = {t["name"]: t for t in client.get(f"{BASE}/mcp/tools").json()["tools"]}
    for name in ("get_site", "get_products", "get_versions", "get_geo_metrics", "get_inquiries"):
        assert tools[name]["mutates"] is False


def test_paid_tools_declare_feature(client):
    tools = {t["name"]: t for t in client.get(f"{BASE}/mcp/tools").json()["tools"]}
    assert tools["create_draft"]["paid_feature"] == "agent.run"
    assert tools["publish_page"]["paid_feature"] == "site.publish"
    assert tools["get_products"]["paid_feature"] is None


def test_update_page_semantics_produce_draft(client):
    """真正验证语义（不只是清单声明）：Agent 产草稿，页面内容未变。"""
    pages = client.get(f"{BASE}/pages").json()
    pid = pages[0]["id"]
    before = client.get(f"{BASE}/pages/{pid}").json()

    # 走 Agent 结构化 patch（等价于 update_page 的实现路径）
    r = client.post(
        f"{BASE}/agent/run",
        json={"entity_type": "page", "entity_id": pid, "patch": {"seo_title": "Agent 建议标题"}},
    )
    assert r.status_code == 200
    assert r.json()["requiresConfirmation"] is True
    assert r.json()["draft"]["id"]

    # 关键：草稿已生成，但页面本身**没有**被直接改动
    after = client.get(f"{BASE}/pages/{pid}").json()
    assert after["seo_title"] == before["seo_title"], "AI 不应直接覆盖线上页面"


# --------------------------------------------------------------------------
# 前后端工具注册表一致性（防止"服务端加了工具、前端没实现"的静默漂移）
# --------------------------------------------------------------------------


def _frontend_tool_names() -> set[str]:
    src = MCP_JS.read_text(encoding="utf-8")
    return set(re.findall(r"^  \{ name: '([a-z_]+)'", src, flags=re.MULTILINE))


def _frontend_implemented_names() -> set[str]:
    src = MCP_JS.read_text(encoding="utf-8")
    return set(re.findall(r"^  async ([a-z_]+)\(", src, flags=re.MULTILINE))


def test_frontend_registry_matches_backend_catalog(client):
    """前端 MCP_TOOLS 的名字集合必须与服务端 /mcp/tools 完全一致。"""
    assert MCP_JS.exists(), f"找不到前端 MCP 注册表：{MCP_JS}"
    backend_names = {t["name"] for t in client.get(f"{BASE}/mcp/tools").json()["tools"]}
    fe_names = _frontend_tool_names()
    assert fe_names == backend_names, (
        f"仅前端有：{sorted(fe_names - backend_names)}；"
        f"仅后端有：{sorted(backend_names - fe_names)}"
    )


def test_every_declared_tool_has_implementation():
    """声明了就必须有实现 —— 不允许"清单里有、调用时 not found"。"""
    declared = _frontend_tool_names()
    implemented = _frontend_implemented_names()
    missing = declared - implemented
    assert not missing, f"以下工具已声明但未实现：{sorted(missing)}"


def test_no_orphan_implementation():
    """反过来：有实现却没在清单里声明，也属于漂移。"""
    declared = _frontend_tool_names()
    implemented = _frontend_implemented_names()
    orphan = implemented - declared
    assert not orphan, f"以下实现未在清单中声明：{sorted(orphan)}"
