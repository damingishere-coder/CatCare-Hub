import hashlib
import json
from collections.abc import Sequence
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.enums import OrderStatus, TaskStatus
from app.models.order import Order, OrderCat
from app.models.task import Task
from app.schemas.plan import PlanScheduleItem
from app.services.orders import task_has_execution_history


PLANNING_TASK_STATUSES = {
    TaskStatus.PENDING,
    TaskStatus.CONFIRMED,
    TaskStatus.READY,
    TaskStatus.CANCELLED,
}
LOCKED_ORDER_STATUSES = {
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
}


def _task_load_options() -> tuple:
    return (
        selectinload(Task.customer),
        selectinload(Task.order)
        .selectinload(Order.cat_links)
        .selectinload(OrderCat.cat),
        selectinload(Task.items),
        selectinload(Task.photos),
    )


def load_day_tasks(session: Session, service_date: date) -> list[Task]:
    return list(
        session.scalars(
            select(Task)
            .options(*_task_load_options())
            .where(Task.service_date == service_date)
            .order_by(Task.sort_order, Task.id)
        ).all()
    )


def load_plan_task(session: Session, task_id: int) -> Task:
    task = session.scalar(
        select(Task).options(*_task_load_options()).where(Task.id == task_id)
    )
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


def _datetime_value(value: object) -> str | None:
    return value.isoformat() if value is not None else None


def day_plan_revision(tasks: Sequence[Task]) -> str:
    state = [
        {
            "id": task.id,
            "order_id": task.order_id,
            "planned_time": _datetime_value(task.planned_time),
            "planned_lat": str(task.planned_lat) if task.planned_lat is not None else None,
            "planned_lng": str(task.planned_lng) if task.planned_lng is not None else None,
            "estimated_arrival": _datetime_value(task.estimated_arrival),
            "sort_order": task.sort_order,
            "status": task.status.value,
            "customer_map_state": {
                "id": task.customer.id,
                "geocode_status": task.customer.geocode_status,
                "latitude": (
                    str(task.customer.latitude)
                    if task.customer.latitude is not None
                    else None
                ),
                "longitude": (
                    str(task.customer.longitude)
                    if task.customer.longitude is not None
                    else None
                ),
                "updated_at": _datetime_value(task.customer.updated_at),
            },
            "updated_at": _datetime_value(task.updated_at),
            "started_at": _datetime_value(task.started_at),
            "completed_at": _datetime_value(task.completed_at),
            "items": [
                {
                    "id": item.id,
                    "type": item.item_type.value,
                    "required": item.required,
                    "completed": item.completed,
                }
                for item in sorted(task.items, key=lambda entry: entry.id)
            ],
            "photo_ids": sorted(photo.id for photo in task.photos),
        }
        for task in sorted(tasks, key=lambda entry: entry.id)
    ]
    serialized = json.dumps(
        state,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def require_current_revision(tasks: Sequence[Task], expected_revision: str) -> None:
    if day_plan_revision(tasks) != expected_revision:
        raise HTTPException(
            status_code=409,
            detail="当日计划已经变化，请刷新后再操作",
        )


def schedule_is_locked(tasks: Sequence[Task]) -> bool:
    return any(task_has_execution_history(task) for task in tasks)


def apply_day_schedule(
    session: Session,
    *,
    service_date: date,
    expected_revision: str,
    schedule: Sequence[PlanScheduleItem],
) -> list[Task]:
    tasks = load_day_tasks(session, service_date)
    if not tasks:
        raise HTTPException(status_code=404, detail="当天没有可排程任务")
    require_current_revision(tasks, expected_revision)
    if schedule_is_locked(tasks):
        raise HTTPException(
            status_code=409,
            detail="当天已有执行记录，计划时间和顺序已锁定",
        )

    tasks_by_id = {task.id: task for task in tasks}
    requested_ids = [item.task_id for item in schedule]
    if set(requested_ids) != set(tasks_by_id):
        raise HTTPException(
            status_code=409,
            detail="必须提交当天全部任务，且不能混入其他日期任务",
        )

    for sort_order, item in enumerate(schedule):
        task = tasks_by_id[item.task_id]
        task.sort_order = sort_order
        task.planned_time = item.planned_time

    session.commit()
    return load_day_tasks(session, service_date)


def update_task_planning_status(
    session: Session,
    *,
    task_id: int,
    expected_revision: str,
    task_status: TaskStatus,
) -> Task:
    task = load_plan_task(session, task_id)
    day_tasks = load_day_tasks(session, task.service_date)
    require_current_revision(day_tasks, expected_revision)

    if task_status not in PLANNING_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="进行中、完成和异常状态由 P6 执行流程维护",
        )
    if task.order.order_status in LOCKED_ORDER_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="订单已取消或已完成，请先通过订单流程处理",
        )
    if task_has_execution_history(task):
        raise HTTPException(
            status_code=409,
            detail="任务已有执行记录，不能改回计划状态",
        )

    task.status = task_status
    session.commit()
    return load_plan_task(session, task_id)
