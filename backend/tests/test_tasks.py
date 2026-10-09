"""任务端点测试：/api/tasks 跟进任务 + 增长任务。"""
BASE = "/api/tasks"


def test_list_tasks_empty_initially(client):
    r = client.get(BASE)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_followup_task(client):
    r = client.post(
        BASE,
        json={"kind": "followup", "title": "回复德国客户询盘", "detail": "确认 MOQ 与交期", "owner": "小李"},
    )
    assert r.status_code == 201
    task = r.json()["task"]
    assert task["kind"] == "followup"
    assert task["status"] == "todo"
    assert task["progress"] == 0
    assert task["owner"] == "小李"


def test_create_growth_task_with_steps(client):
    r = client.post(
        BASE,
        json={
            "kind": "growth",
            "title": "网站诊断服务任务",
            "steps": [{"label": "抓取页面", "done": False}, {"label": "输出报告", "done": False}],
        },
    )
    assert r.status_code == 201
    task = r.json()["task"]
    assert task["kind"] == "growth"
    assert len(task["steps"]) == 2


def test_create_task_missing_title_422(client):
    assert client.post(BASE, json={"kind": "followup"}).status_code == 422


def test_create_task_invalid_kind_422(client):
    assert client.post(BASE, json={"kind": "unknown_kind", "title": "x"}).status_code == 422


def test_filter_tasks_by_kind(client):
    client.post(BASE, json={"kind": "followup", "title": "跟进任务 A"})
    client.post(BASE, json={"kind": "growth", "title": "增长任务 B"})

    followups = client.get(f"{BASE}?kind=followup").json()
    growths = client.get(f"{BASE}?kind=growth").json()
    assert all(t["kind"] == "followup" for t in followups)
    assert all(t["kind"] == "growth" for t in growths)
    assert any(t["title"] == "跟进任务 A" for t in followups)


def test_advance_task_without_steps_cycles(client):
    """无子步骤时 todo → doing → done 循环推进。"""
    tid = client.post(BASE, json={"kind": "followup", "title": "循环任务"}).json()["task"]["id"]

    assert client.post(f"{BASE}/{tid}/advance").json()["task"]["status"] == "doing"
    assert client.post(f"{BASE}/{tid}/advance").json()["task"]["status"] == "done"
    assert client.post(f"{BASE}/{tid}/advance").json()["task"]["status"] == "todo"


def test_advance_task_with_steps_tracks_progress(client):
    """有子步骤时逐项勾选，进度按比例计算，全勾选后任务完成。"""
    steps = [{"label": "步骤1", "done": False}, {"label": "步骤2", "done": False}]
    tid = client.post(BASE, json={"kind": "growth", "title": "多步任务", "steps": steps}).json()["task"]["id"]

    t1 = client.post(f"{BASE}/{tid}/advance").json()["task"]
    assert t1["progress"] == 50
    assert t1["status"] == "doing"
    assert t1["steps"][0]["done"] is True

    t2 = client.post(f"{BASE}/{tid}/advance").json()["task"]
    assert t2["progress"] == 100
    assert t2["status"] == "done"


def test_update_task_status_done_forces_progress_100(client):
    tid = client.post(BASE, json={"kind": "followup", "title": "状态联动"}).json()["task"]["id"]
    r = client.put(f"{BASE}/{tid}", json={"status": "done"})
    assert r.status_code == 200
    task = r.json()["task"]
    assert task["status"] == "done"
    assert task["progress"] == 100


def test_update_task_partial_patch_keeps_other_fields(client):
    """只传 title 时，其余字段不应被清空。"""
    tid = client.post(BASE, json={"kind": "followup", "title": "原名", "detail": "原说明", "owner": "小王"}).json()["task"]["id"]
    client.put(f"{BASE}/{tid}", json={"title": "新名"})
    task = client.get(f"{BASE}/{tid}").json()
    assert task["title"] == "新名"
    assert task["detail"] == "原说明"
    assert task["owner"] == "小王"


def test_update_task_invalid_progress_422(client):
    tid = client.post(BASE, json={"kind": "followup", "title": "越界"}).json()["task"]["id"]
    assert client.put(f"{BASE}/{tid}", json={"progress": 150}).status_code == 422


def test_update_missing_task_404(client):
    assert client.put(f"{BASE}/nope", json={"title": "x"}).status_code == 404


def test_get_missing_task_404(client):
    assert client.get(f"{BASE}/nope").status_code == 404


def test_delete_task(client):
    tid = client.post(BASE, json={"kind": "followup", "title": "待删除"}).json()["task"]["id"]
    assert client.delete(f"{BASE}/{tid}").status_code == 200
    assert client.get(f"{BASE}/{tid}").status_code == 404


def test_followup_task_advances_inquiry_to_contacted(seed_client):
    """创建关联询盘的跟进任务时，询盘应从 new 推进到 contacted。"""
    inquiries = seed_client.get("/api/inquiries").json()["inquiries"]
    target = next(i for i in inquiries if i["status"] == "new")

    r = seed_client.post(
        BASE,
        json={"kind": "followup", "title": "跟进该客户", "inquiry_id": target["id"]},
    )
    assert r.status_code == 201

    after = seed_client.get(f"/api/inquiries/{target['id']}").json()
    assert after["status"] == "contacted"


def test_task_stats_summary(client):
    client.post(BASE, json={"kind": "followup", "title": "统计任务1"})
    tid = client.post(BASE, json={"kind": "followup", "title": "统计任务2"}).json()["task"]["id"]
    client.put(f"{BASE}/{tid}", json={"status": "done"})

    r = client.get(f"{BASE}/stats/summary")
    assert r.status_code == 200
    s = r.json()
    assert s["total"] >= 2
    assert s["done"] >= 1
    assert 0 <= s["percent"] <= 100
    assert s["kind"] == "all"


def _seed_kind_tasks(client, kind, total, done):
    ids = []
    for i in range(total):
        ids.append(client.post(BASE, json={"kind": kind, "title": f"{kind}-{i}"}).json()["task"]["id"])
    for tid in ids[:done]:
        client.put(f"{BASE}/{tid}", json={"status": "done"})
    return ids


def test_task_stats_filters_by_kind(client):
    """按 kind 统计时，分母也必须只算该 kind —— 否则百分比永远偏小。"""
    _seed_kind_tasks(client, "growth", total=3, done=1)
    _seed_kind_tasks(client, "followup", total=1, done=0)

    g = client.get(f"{BASE}/stats/summary", params={"kind": "growth"}).json()
    assert g["kind"] == "growth"
    assert g["total"] == 3
    assert g["done"] == 1
    assert g["todo"] == 2
    assert g["percent"] == 33, "percent 分母应只含 growth"

    f = client.get(f"{BASE}/stats/summary", params={"kind": "followup"}).json()
    assert f["total"] == 1
    assert f["done"] == 0
    assert f["percent"] == 0

    a = client.get(f"{BASE}/stats/summary").json()
    assert a["total"] == g["total"] + f["total"]
    assert a["percent"] == 25, "全局 1/4 = 25%"


def test_task_stats_empty_kind_is_zero_not_error(client):
    """没有任何该类型任务时应返回 0 而不是除零崩溃或报错。"""
    _seed_kind_tasks(client, "followup", total=2, done=2)

    r = client.get(f"{BASE}/stats/summary", params={"kind": "growth"})
    assert r.status_code == 200
    s = r.json()
    assert s == {"kind": "growth", "total": 0, "done": 0, "doing": 0, "todo": 0, "percent": 0}


def test_task_stats_todo_never_negative(client):
    """todo 由减法得出，异常数据下也不能出现负数。"""
    tid = client.post(BASE, json={"kind": "growth", "title": "边界任务"}).json()["task"]["id"]
    client.put(f"{BASE}/{tid}", json={"status": "doing"})

    s = client.get(f"{BASE}/stats/summary", params={"kind": "growth"}).json()
    assert s["todo"] >= 0
    assert s["todo"] == s["total"] - s["done"] - s["doing"]
