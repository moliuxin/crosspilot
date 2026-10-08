"""P0-AI-SITE-GENERATION + P0-MARKET-PROFILE + P0-ENTITLEMENT 测试。

核心断言（对应指令）：
- 输入产品类别（工业水泵）→ 结构化生成站点：结构 / 文案 / CTA / 三市场差异；
- AI 图片全部与产品类别相关，Asset 记录 source_type=REAL/AI_GENERATED 溯源；
- 免费完整生成为账号级：成功才扣、失败不扣、用完 402、不同站点不重复免费；
- AI 画笔为付费能力：免费 403（后端硬校验），growth 200；
- 三语 Market Profile 字段齐全且互不相同；Fact Layer 共享不被市场改写。
"""
import pytest

BASE = "/api"


# ---------------- Market Profile ----------------

def test_market_profiles_shape(client):
    res = client.get(f"{BASE}/market-profiles")
    assert res.status_code == 200
    body = res.json()
    markets = {m["market"]: m for m in body["markets"]}
    assert set(markets) >= {"zh-CN", "en-US", "ru-RU"}
    required = {
        "content_hierarchy", "buyer_focus", "hero_strategy", "product_card_fields",
        "trust_evidence_priority", "cta_style", "faq_topics", "visual_style",
        "image_style", "layout_density", "typography_guidance", "tone", "seo_guidance",
    }
    for m, p in markets.items():
        missing = required - set(p.keys())
        assert not missing, f"{m} 缺字段: {missing}"
    # 三市场表达真实不同（不是翻译）
    assert markets["zh-CN"]["hero_strategy"] != markets["en-US"]["hero_strategy"]
    assert markets["en-US"]["cta_style"] != markets["ru-RU"]["cta_style"]
    assert markets["zh-CN"]["content_hierarchy"] != markets["ru-RU"]["content_hierarchy"]
    # Fact Layer 边界下发
    assert "sku" in body["sharedFactFields"]


def test_market_profiles_require_login(anon_client):
    assert anon_client.get(f"{BASE}/market-profiles").status_code == 401


# ---------------- AI 整站生成 ----------------

def _generate(c, **kw):
    payload = {
        "company_name": "测试泵业",
        "product_category": "工业水泵",
        "product_description": "离心泵,出口俄罗斯与欧洲",
        "target_buyer": "工程采购商",
        "target_markets": ["zh-CN", "en-US", "ru-RU"],
        "preferred_style": "professional",
        **kw,
    }
    return c.post(f"{BASE}/sites/generate", json=payload)


def test_generate_site_full_flow(free_client, db_session):
    """工业水泵 → 完整站点:结构 / 三市场差异 / AI 图片溯源 / 免费额度扣减。"""
    usage_before = free_client.get(f"{BASE}/usage").json()

    res = _generate(free_client)
    assert res.status_code == 201, res.text
    body = res.json()
    site = body["site"]
    plan = body["plan"]

    assert site["product_category"] == "工业水泵"
    assert set(site["target_markets"]) == {"zh-CN", "en-US", "ru-RU"}

    # 站点页面落库(≥6,刷新仍存在)
    pages = free_client.get(f"{BASE}/pages?site_id={site['id']}").json()
    assert len(pages) >= 6
    home = next(p for p in pages if p["is_home"])
    assert any(s["type"] == "hero" for s in home["sections"])

    # 三市场表达互不相同(非翻译)
    heroes = {m: plan["markets"][m]["hero"] for m in ("zh-CN", "en-US", "ru-RU")}
    titles = {h["title"] for h in heroes.values()}
    assert len(titles) == 3, f"三市场 hero 标题应互不相同: {titles}"
    assert all("工业水泵" in p["hero"].get("title", "") or "工业水泵" in p["hero"].get("description", "") or m == "en-US" or m == "ru-RU" for m, p in plan["markets"].items())

    # 图片资产:与类别相关 + 溯源
    assets = body["assets"]
    assert len(assets) >= 3
    assert all(a["source_type"] == "AI_GENERATED" for a in assets)
    assert all("工业水泵" in a["prompt"] for a in assets), "图片 prompt 必须包含产品类别"
    assert any(a["market"] == "ru-RU" for a in assets) and any(a["market"] == "zh-CN" for a in assets)
    # 禁止伪造事实元素进入 prompt
    assert all("no fabricated certification" in a["prompt"] for a in assets)

    # 资产可按站点查询(含溯源)
    listed = free_client.get(f"{BASE}/sites/{site['id']}/assets").json()["assets"]
    assert {a["id"] for a in listed} >= {a["id"] for a in assets[:1]}

    # 免费额度:成功后扣 1(账号级)
    usage_after = free_client.get(f"{BASE}/usage").json()
    assert usage_after["freeGenerationUsed"] == usage_before["freeGenerationUsed"] + 1
    assert body["free_quota"]["used"] == usage_after["freeGenerationUsed"]

    # plan 结构完整(指令要求的 JSON 字段)
    for key in ("industry_profile", "buyer_personas", "markets", "site_structure",
                "sections", "cta_plan", "trust_plan", "seo_plan", "image_briefs",
                "visual_style_profile"):
        assert key in plan, f"plan 缺 {key}"


def test_generate_second_time_no_free_quota(free_client):
    """免费额度用完后再次生成 → 402(账号级,不因新站点重置)。"""
    assert _generate(free_client).status_code == 201
    second = _generate(free_client, company_name="第二个站")
    assert second.status_code == 402
    # 额度仍然只扣 1(402 不扣)
    assert free_client.get(f"{BASE}/usage").json()["freeGenerationUsed"] == 1


def test_generate_with_paid_plan_not_limited(client):
    """growth 套餐不受免费 1 次限制。"""
    assert _generate(client).status_code == 201
    assert _generate(client, company_name="再来一个").status_code == 201


def test_generate_invalid_input_keeps_quota(free_client):
    """入参失败(422)不扣免费额度。"""
    bad = free_client.post(f"{BASE}/sites/generate", json={"product_category": "  ", "target_markets": ["zh-CN"]})
    assert bad.status_code == 422
    bad2 = free_client.post(f"{BASE}/sites/generate", json={"product_category": "水泵", "target_markets": ["xx-XX"]})
    assert bad2.status_code == 422
    assert free_client.get(f"{BASE}/usage").json()["freeGenerationUsed"] == 0


def test_generate_requires_login(anon_client):
    assert anon_client.post(f"{BASE}/sites/generate", json={"product_category": "泵"}).status_code == 401


def test_generated_site_tenant_isolated(free_client, second_client):
    res = _generate(free_client)
    site_id = res.json()["site"]["id"]
    assert second_client.get(f"{BASE}/sites/{site_id}").status_code == 404
    assert second_client.get(f"{BASE}/pages?site_id={site_id}").status_code == 404
    assert second_client.get(f"{BASE}/sites/{site_id}/assets").status_code == 404


# ---------------- AI 画笔付费硬校验 ----------------

def test_brush_free_user_403(free_client, db_session):
    """免费账户直接调 AI 画笔 API → 403(后端校验,不依赖前端锁)。"""
    pages = free_client.get(f"{BASE}/pages").json()
    if not pages:
        pages = free_client.get(f"{BASE}/pages").json()
    page_id = pages[0]["id"] if pages else "page_none"
    res = free_client.post(f"{BASE}/brush/preview", json={"page_id": page_id, "instruction": "把标题改得更突出"})
    assert res.status_code == 403


def test_brush_growth_user_ok(client):
    """growth 套餐可用 AI 画笔。"""
    pages = client.get(f"{BASE}/pages").json()
    page_id = pages[0]["id"]
    res = client.post(f"{BASE}/brush/preview", json={"page_id": page_id, "instruction": "把标题改得更突出"})
    assert res.status_code == 200
    assert res.json()["sections"]


def test_brush_page_not_found(client):
    res = client.post(f"{BASE}/brush/preview", json={"page_id": "page_missing", "instruction": "x"})
    assert res.status_code == 404


def test_brush_requires_login(anon_client):
    assert anon_client.post(f"{BASE}/brush/preview", json={"page_id": "p", "instruction": "x"}).status_code == 401
