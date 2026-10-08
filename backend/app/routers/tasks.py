"""任务端点：询盘跟进任务 + AI 增长服务任务。

两类任务共用一张表，通过 kind 区分：
- followup：询盘中心「创建跟进」
- growth：AI 增长页提交的服务任务（带进度与子步骤）
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import tenant_scope
from ..tenancy import scoped_get, scoped_get_or_none
from ..utils import new_id

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("")
def list_tasks(
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    kind: str | None = Query(default=None, description="followup | growth"),
    status: str | None = None,
):
    q = db.query(models.TaskItem).filter(models.TaskItem.tenant_id == tid)
    if kind:
        q = q.filter(models.TaskItem.kind == kind)
    if status:
        q = q.filter(models.TaskItem.status == status)
    items = q.order_by(models.TaskItem.created_at.desc()).all()
    return [t.to_dict() for t in items]


@router.post("", status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    steps = payload.steps or []
    task = models.TaskItem(
        id=new_id("task"),
        tenant_id=tid,
        kind=payload.kind,
        title=payload.title,
        detail=payload.detail,
        inquiry_id=payload.inquiry_id,
        owner=payload.owner,
        due_at=payload.due_at,
        steps=steps,
        progress=0,
        status="todo",
    )
    db.add(task)

    # 跟进任务关联询盘时，把询盘推进到「已联系」（若仍为 new）
    if payload.kind == "followup" and payload.inquiry_id:
        inq = scoped_get_or_none(db, models.Inquiry, payload.inquiry_id, tid)
        if inq and inq.status == "new":
            inq.status = "contacted"

    db.commit()
    db.refresh(task)
    return {"ok": True, "task": task.to_dict()}


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    t = scoped_get(db, models.TaskItem, task_id, tid, detail="任务不存在")
    return t.to_dict()


@router.put("/{task_id}")
def update_task(task_id: str, payload: schemas.TaskUpdate, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    t = scoped_get(db, models.TaskItem, task_id, tid, detail="任务不存在")

    data = payload.model_dump(exclude_unset=True)
    for key in ("title", "detail", "owner", "due_at"):
        if key in data and data[key] is not None:
            setattr(t, key, data[key])
    if "steps" in data and data["steps"] is not None:
        t.steps = data["steps"]
    if "progress" in data and data["progress"] is not None:
        t.progress = data["progress"]
    if "status" in data and data["status"] is not None:
        t.status = data["status"]
        # 状态联动：完成 → 100%，开始 → 至少 10%
        if data["status"] == "done":
            t.progress = 100
        elif data["status"] == "doing" and (t.progress or 0) == 0:
            t.progress = 10

    db.commit()
    db.refresh(t)
    return {"ok": True, "task": t.to_dict()}


@router.post("/{task_id}/advance")
def advance_task(task_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    """推进任务：按子步骤顺序勾选下一项，全部完成则任务完成。"""
    t = scoped_get(db, models.TaskItem, task_id, tid, detail="任务不存在")

    # 注意：必须构造「全新的」steps 对象再整体赋值。
    # 若只做 list(t.steps) 浅拷贝并原地改嵌套 dict，SQLAlchemy 的变更追踪会判定为新旧相等，
    # 从而跳过 UPDATE，导致子步骤勾选丢失（progress 却变了）。
    steps = [dict(s) for s in (t.steps or [])]
    if steps:
        advanced = False
        for s in steps:
            if not s.get("done"):
                s["done"] = True
                advanced = True
                break
        if not advanced:
            # 已全部完成 → 重置为未开始
            for s in steps:
                s["done"] = False
        t.steps = steps
        done = sum(1 for s in steps if s.get("done"))
        t.progress = round(done / len(steps) * 100)
        t.status = "done" if done == len(steps) else ("doing" if done > 0 else "todo")
    else:
        # 无子步骤：在 todo → doing → done 之间循环
        nxt = {"todo": "doing", "doing": "done", "done": "todo"}
        t.status = nxt.get(t.status, "doing")
        t.progress = {"todo": 0, "doing": 50, "done": 100}[t.status]

    db.commit()
    db.refresh(t)
    return {"ok": True, "task": t.to_dict()}


@router.delete("/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db), tid: int = Depends(tenant_scope)):
    t = scoped_get(db, models.TaskItem, task_id, tid, detail="任务不存在")
    db.delete(t)
    db.commit()
    return {"ok": True, "id": task_id}


@router.get("/stats/summary")
def task_stats(
    db: Session = Depends(get_db),
    tid: int = Depends(tenant_scope),
    kind: str | None = Query(default=None, description="followup | growth"),
):
    """任务进度汇总。

    kind 过滤必须作用在**所有计数**上（含 percent 的分母），
    否则「按类型看进度」会拿全局总数当分母 —— 例如只看 growth 任务时
    分母却含 followup，percent 永远是错的。
    """
    q = db.query(models.TaskItem).filter(models.TaskItem.tenant_id == tid)
    if kind:
        q = q.filter(models.TaskItem.kind == kind)

    total = q.count()
    done = q.filter(models.TaskItem.status == "done").count()
    doing = q.filter(models.TaskItem.status == "doing").count()
    return {
        "kind": kind or "all",
        "total": total,
        "done": done,
        "doing": doing,
        "todo": max(total - done - doing, 0),
        "percent": round(done / total * 100) if total else 0,
    }
