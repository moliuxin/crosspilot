"""页面编辑器端点测试：/api/pages 增删改查 + AI 改写。"""
import pytest

BASE = "/api/pages"


def test_seed_pages_available(client):
    """首次访问自动播种 6 个页面，且首页唯一。"""
    r = client.get(BASE)
    assert r.status_code == 200
    pages = r.json()
    assert len(pages) >= 6
    assert sum(1 for p in pages if p["is_home"]) == 1
    names = [p["name"] for p in pages]
    assert "首页" in names


def test_page_has_ordered_sections(client):
    """页面区块是有序数组，且首页含 hero / products / cta。"""
    pages = client.get(BASE).json()
    home = next(p for p in pages if p["is_home"])
    types = [s["type"] for s in home["sections"]]
    assert len(types) >= 6
    assert "hero" in types
    assert "products" in types
    assert "cta" in types


def test_get_single_page(client):
    pid = client.get(BASE).json()[0]["id"]
    r = client.get(f"{BASE}/{pid}")
    assert r.status_code == 200
    assert r.json()["id"] == pid


def test_get_missing_page_404(client):
    assert client.get(f"{BASE}/page_not_exist").status_code == 404


def test_update_page_sections_persisted(client):
    """保存组件树：提交的区块被写入，未提交的旧区块保留（合并语义，不静默删除）。"""
    pid = client.get(BASE).json()[0]["id"]
    before = client.get(f"{BASE}/{pid}").json()["sections"]
    before_ids = {s["id"] for s in before}

    payload = {
        "sections": [
            {"id": "s1", "type": "hero", "label": "首屏", "props": {"title": "新标题 A", "cta": "获取报价"}},
            {"id": "s2", "type": "cta", "label": "转化", "props": {"title": "联系我们"}},
        ]
    }
    r = client.put(f"{BASE}/{pid}", json=payload)
    assert r.status_code == 200

    after = client.get(f"{BASE}/{pid}").json()["sections"]
    by_id = {s["id"]: s for s in after}

    # 提交的两个区块按提交顺序排在最前
    assert after[0]["id"] == "s1"
    assert after[1]["id"] == "s2"
    assert by_id["s1"]["props"]["title"] == "新标题 A"
    assert by_id["s1"]["props"]["cta"] == "获取报价"
    assert by_id["s2"]["type"] == "cta"

    # 未提交的旧区块必须保留在末尾，不能被静默删除
    for sid in before_ids:
        assert sid in by_id, f"未提交的区块 {sid} 被删除了"


def test_update_page_merges_props_without_losing_existing(client):
    """只提交部分 props 时，同 id 区块的其余 props 应深合并保留（不整体覆盖）。"""
    pid = client.get(BASE).json()[0]["id"]
    client.put(
        f"{BASE}/{pid}",
        json={"sections": [{"id": "s1", "type": "hero", "label": "首屏", "props": {"title": "A", "eyebrow": "EYE", "cta": "GO"}}]},
    )

    # 第二次只改 title，不带 eyebrow / cta
    client.put(
        f"{BASE}/{pid}",
        json={"sections": [{"id": "s1", "type": "hero", "label": "首屏", "props": {"title": "B"}}]},
    )

    props = next(s for s in client.get(f"{BASE}/{pid}").json()["sections"] if s["id"] == "s1")["props"]
    assert props["title"] == "B"
    assert props["eyebrow"] == "EYE", "未提交的 props 字段被覆盖丢失"
    assert props["cta"] == "GO", "未提交的 props 字段被覆盖丢失"


def test_update_page_preserves_existing_sections_when_styling_one(client):
    """样式面板只写选中区块 —— 其余区块不得丢失（曾因整体替换导致站点结构消失）。"""
    pid = client.get(BASE).json()[0]["id"]
    before = client.get(f"{BASE}/{pid}").json()["sections"]
    assert len(before) >= 6

    target = before[0]
    styled = {**target, "props": {**target.get("props", {}), "align": "center", "background": "brand", "padding": "loose"}}
    assert client.put(f"{BASE}/{pid}", json={"sections": [styled]}).status_code == 200

    after = client.get(f"{BASE}/{pid}").json()["sections"]
    assert len(after) == len(before), f"区块数从 {len(before)} 变成 {len(after)}"

    by_id = {s["id"]: s for s in after}
    assert by_id[target["id"]]["props"]["background"] == "brand"
    # 其余区块内容原样保留
    for s in before:
        if s["id"] == target["id"]:
            continue
        assert by_id[s["id"]]["props"] == s["props"]


def test_update_page_invalid_section_type_422(client):
    pid = client.get(BASE).json()[0]["id"]
    r = client.put(f"{BASE}/{pid}", json={"sections": [{"id": "x", "type": "not_a_type"}]})
    assert r.status_code == 422


def test_update_missing_page_404(client):
    assert client.put(f"{BASE}/nope", json={"name": "x"}).status_code == 404


def test_create_page(client):
    r = client.post(BASE, json={"name": "新品发布页", "slug": "new-launch", "sections": []})
    assert r.status_code == 201
    pid = r.json().get("page", {}).get("id") or r.json().get("id")
    assert pid
    assert client.get(f"{BASE}/{pid}").status_code == 200


def test_delete_page(client):
    pid = client.post(BASE, json={"name": "待删除页", "slug": "tmp"}).json().get("page", {}).get("id")
    if not pid:
        pid = client.get(BASE).json()[-1]["id"]
    assert client.delete(f"{BASE}/{pid}").status_code == 200
    assert client.get(f"{BASE}/{pid}").status_code == 404


def test_home_page_cannot_be_deleted(client):
    """首页是站点入口，删除应被拒绝（400）。"""
    home = next(p for p in client.get(BASE).json() if p["is_home"])
    assert client.delete(f"{BASE}/{home['id']}").status_code == 400
    assert client.get(f"{BASE}/{home['id']}").status_code == 200


@pytest.mark.parametrize("field", ["title", "subtitle", "description", "cta"])
def test_ai_rewrite_returns_text_for_each_field(client, field):
    """四个可改写字段都必须返回 before/after 与来源标注。"""
    pid = client.get(BASE).json()[0]["id"]
    r = client.post(
        f"{BASE}/{pid}/ai-rewrite",
        json={"section_id": "s1", "field": field, "instruction": "更强调交期", "market": "en-US"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["field"] == field
    assert data["before"]
    assert data["after"]
    assert data["ai_source"] in {"llm", "template", "mock"}


def test_ai_rewrite_does_not_persist_until_saved(client):
    """AI 改写只返回建议值，不得直接改动线上页面（需前端确认后 PUT 保存）。"""
    pid = client.get(BASE).json()[0]["id"]
    before_sections = client.get(f"{BASE}/{pid}").json()["sections"]

    client.post(
        f"{BASE}/{pid}/ai-rewrite",
        json={"section_id": before_sections[0]["id"], "field": "title", "instruction": "改一下"},
    )

    after_sections = client.get(f"{BASE}/{pid}").json()["sections"]
    assert after_sections == before_sections


def test_ai_rewrite_instruction_changes_output(client):
    """带指令的改写结果应与不带指令不同，证明确实消费了 instruction。"""
    pid = client.get(BASE).json()[0]["id"]

    def rewrite(instruction):
        r = client.post(
            f"{BASE}/{pid}/ai-rewrite",
            json={"section_id": "s1", "field": "title", "instruction": instruction, "market": "zh-CN"},
        )
        return r.json()

    plain = rewrite("")
    hinted = rewrite("强调七天快速交付与一年质保")
    assert plain["after"] and hinted["after"]
    assert plain["after"] != hinted["after"]


def test_ai_rewrite_invalid_field_422(client):
    pid = client.get(BASE).json()[0]["id"]
    r = client.post(f"{BASE}/{pid}/ai-rewrite", json={"section_id": "s1", "field": "not_a_field"})
    assert r.status_code == 422


def test_ai_rewrite_missing_page_404(client):
    r = client.post(f"{BASE}/nope/ai-rewrite", json={"section_id": "s1", "field": "title"})
    assert r.status_code == 404


# ---------- 区块样式属性（页面编辑器「样式」面板）----------

def test_section_style_props_persisted(client):
    """样式面板写入的 padding/align/background 必须真落库，刷新后仍在。

    这三个字段驱动画布的 block-pad-* / block-align-* / block-bg-* 类名，
    若落库丢失，用户会看到「样式改完保存后刷新就没了」。
    """
    pid = client.get(BASE).json()[0]["id"]
    payload = {
        "sections": [
            {
                "id": "s1",
                "type": "hero",
                "label": "首屏",
                "props": {
                    "title": "带样式的新标题",
                    "align": "center",
                    "background": "brand",
                    "padding": "loose",
                },
            }
        ]
    }
    assert client.put(f"{BASE}/{pid}", json=payload).status_code == 200

    after = client.get(f"{BASE}/{pid}").json()
    props = after["sections"][0]["props"]
    assert props["align"] == "center"
    assert props["background"] == "brand"
    assert props["padding"] == "loose"
    # 内容字段不受影响
    assert props["title"] == "带样式的新标题"


def test_section_style_props_default_when_absent(client):
    """未设置样式时不应凭空注入字段，由前端按 light/left/comfortable 兜底。"""
    pid = client.get(BASE).json()[0]["id"]
    payload = {"sections": [{"id": "s1", "type": "cta", "label": "CTA", "props": {"title": "联系我们"}}]}
    assert client.put(f"{BASE}/{pid}", json=payload).status_code == 200

    props = client.get(f"{BASE}/{pid}").json()["sections"][0]["props"]
    assert props == {"title": "联系我们"}


def test_section_style_props_survive_unrelated_update(client):
    """只改文案时，已有的样式属性不能被覆盖丢失。"""
    pid = client.get(BASE).json()[0]["id"]
    styled = {
        "sections": [
            {
                "id": "s1",
                "type": "hero",
                "label": "首屏",
                "props": {"title": "A", "align": "right", "background": "dark", "padding": "compact"},
            }
        ]
    }
    client.put(f"{BASE}/{pid}", json=styled)

    # 模拟前端只改了 title（保留其余 props）
    next_props = dict(styled["sections"][0]["props"])
    next_props["title"] = "B"
    client.put(f"{BASE}/{pid}", json={"sections": [{**styled["sections"][0], "props": next_props}]})

    props = client.get(f"{BASE}/{pid}").json()["sections"][0]["props"]
    assert props["title"] == "B"
    assert (props["align"], props["background"], props["padding"]) == ("right", "dark", "compact")
