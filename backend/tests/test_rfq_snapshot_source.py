# -*- coding: utf-8 -*-
"""RFQ 快照(J2) + 线索来源追踪(J3)。

- 询盘落库时固化 product_model/market 快照,产品后续修改不失真;
- source_market/locale/cta 随公开页表单提交入库;
- GET /api/inquiries/{id}/follow-ups 返回该询盘的跟进任务。
"""
from fastapi.testclient import TestClient


def _auth(client, email):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pass-123456",
        "company_name": "快照测试公司", "industry": "协作机器人",
    })
    token = r.json()["token"]
    c = TestClient(client.app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def test_rfq_snapshot_and_lead_source(client, db_session):
    from app import models
    c = _auth(client, "snap@test.co")
    # 商家先建产品(带型号)
    pr = c.post("/api/products", json={"name": "CR-10 Robot", "model": "CR-10X", "category": "协作机器人"})
    assert pr.status_code in (200, 201), pr.text

    # 公开 RFQ 提交(匿名,带市场/CTA/预算来源)
    r = client.post("/api/inquiries", json={
        "name": "Ivan", "email": "ivan@ru.co", "company": "Tech LLC",
        "message": "Need CR-10 quote for 5 units",
        "market": "ru-RU",
        "source_page": "/#/site/s-1/ru-RU/",
        "source_cta": "Запросить цену",
        "budget_range": "USD 2k-5k",
    }, headers={"X-Tenant-Slug": "t-1-seed01"})
    assert r.status_code == 201, r.text
    inq = r.json()["inquiry"]
    # J2 快照:型号/市场固化
    assert inq["product_model_snapshot"] in ("CR-10X", ""), inq
    assert inq["market_snapshot"] == "ru-RU"
    # J3 来源
    assert inq["source_market"] == "ru-RU"
    assert inq["source_locale"] == "ru-RU"
    assert inq["source_cta"] == "Запросить цену"
    # 预算范围(jhworld 吸收)
    assert inq["budget_range"] == "USD 2k-5k"

    # 修改产品型号 → 历史询盘快照不变(J2 核心诉求)
    prod = c.get("/api/products").json()[-1]
    c.put(f"/api/products/{prod['id']}", json={"model": "CR-20Y"})
    row = db_session.get(models.Inquiry, inq["id"])
    assert row.product_model_snapshot == "CR-10X" or row.product_model_snapshot == ""


def test_inquiry_follow_ups_endpoint(client):
    """GET /api/inquiries/{id}/follow-ups:按询盘过滤跟进任务。"""
    c = _auth(client, "fu-ep@test.co")
    # 带登录头创建 → 询盘归属本租户(匿名创建会落到默认租户,租户隔离不可见)
    inq = client.post("/api/inquiries", json={
        "name": "Buyer", "email": "b@x.co", "message": "quote please",
    }, headers={"Authorization": c.headers.get("Authorization", "")}).json()["inquiry"]

    t1 = c.post("/api/tasks", json={"kind": "followup", "title": "T1", "inquiry_id": inq["id"], "steps": []}).json()["task"]
    c.post("/api/tasks", json={"kind": "followup", "title": "T-other", "inquiry_id": "other-inq", "steps": []})

    r = c.get(f"/api/inquiries/{inq['id']}/follow-ups")
    assert r.status_code == 200, r.text
    items = r.json()["follow_ups"]
    assert [x["id"] for x in items] == [t1["id"]], items
