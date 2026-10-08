"""询盘中心：列表 / 详情 / 状态流转 / RFQ 提交。"""


def test_list_inquiries_with_stats(seed_client):
    client = seed_client
    res = client.get("/api/inquiries")
    assert res.status_code == 200
    body = res.json()
    assert "inquiries" in body
    assert "stats" in body
    items = body["inquiries"]
    assert len(items) >= 5
    stats = body["stats"]
    # 统计卡片：本月询盘量 / 高意向 / 平均响应 / 转化率
    assert stats["monthly"]["value"] == str(len(items))
    assert "highIntent" in stats
    assert "avgResponse" in stats
    assert "conversion" in stats


def test_get_inquiry_detail(seed_client):
    client = seed_client
    res = client.get("/api/inquiries/rfq_001")
    assert res.status_code == 200
    assert res.json()["customer_name"] == "Michael Kim"


def test_get_inquiry_404(client):
    assert client.get("/api/inquiries/nope").status_code == 404


def test_update_inquiry_status(seed_client):
    client = seed_client
    res = client.put("/api/inquiries/rfq_001", json={"status": "following"})
    assert res.status_code == 200
    assert client.get("/api/inquiries/rfq_001").json()["status"] == "following"


def test_update_inquiry_status_invalid_value(client):
    """状态只能是枚举内值，否则 422。"""
    res = client.put("/api/inquiries/rfq_001", json={"status": "banana"})
    assert res.status_code == 422


def test_update_inquiry_404(client):
    res = client.put("/api/inquiries/nope", json={"status": "done"})
    assert res.status_code == 404


def test_create_inquiry_from_rfq_form(client):
    res = client.post(
        "/api/inquiries",
        json={
            "name": "John Doe",
            "email": "john@example.com",
            "company": "Acme",
            "country": "Germany",
            "message": "Please quote the Industrial RO System, urgent project.",
        },
    )
    assert res.status_code == 201
    inquiry = res.json()["inquiry"]
    assert inquiry["customer_name"] == "John Doe"
    assert inquiry["status"] == "new"
    # 含 quote/urgent → hot
    assert inquiry["intent"] == "hot"

    # 出现在列表里
    listing = client.get("/api/inquiries").json()["inquiries"]
    assert any(i["id"] == inquiry["id"] for i in listing)


def test_create_inquiry_invalid_email(client):
    res = client.post(
        "/api/inquiries",
        json={"name": "Bad", "email": "not-an-email", "message": "hi"},
    )
    assert res.status_code == 422
