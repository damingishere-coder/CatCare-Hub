import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.models.order import Order
from app.models.task import Task


CONFLICT_DETAIL = "订单已在其他页面更新，请刷新后重试"


def order_write_revision(order: Order) -> str:
    value = f"{order.id}:{order.write_revision_number}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def order_payload_hash(payload: Any) -> str:
    body = {
        "schema": payload.__class__.__name__,
        "payload": payload.model_dump(mode="json"),
    }
    serialized = json.dumps(
        body,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def require_order_revision(order: Order, expected_revision: str) -> None:
    if order_write_revision(order) != expected_revision:
        raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)


def reserve_order_revision(
    session: Session,
    order: Order,
    expected_revision: str,
) -> None:
    """Atomically reserve the next order write version inside the current transaction."""

    require_order_revision(order, expected_revision)
    previous = order.write_revision_number
    result = session.execute(
        update(Order)
        .where(
            Order.id == order.id,
            Order.write_revision_number == previous,
        )
        .values(write_revision_number=previous + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)
    set_committed_value(order, "write_revision_number", previous + 1)


def reserve_internal_order_revision(session: Session, order: Order) -> None:
    previous = order.write_revision_number
    result = session.execute(
        update(Order)
        .where(
            Order.id == order.id,
            Order.write_revision_number == previous,
        )
        .values(write_revision_number=previous + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)
    set_committed_value(order, "write_revision_number", previous + 1)


def bump_task_revision(task: Task) -> None:
    task.execution_revision_number += 1


def reserve_internal_task_revision(session: Session, task: Task) -> None:
    """Conditionally bump task and order versions after an aggregate token check."""

    task_revision = task.execution_revision_number
    order_revision = task.order.write_revision_number
    task_result = session.execute(
        update(Task)
        .where(
            Task.id == task.id,
            Task.execution_revision_number == task_revision,
        )
        .values(execution_revision_number=task_revision + 1)
        .execution_options(synchronize_session=False)
    )
    order_result = session.execute(
        update(Order)
        .where(
            Order.id == task.order_id,
            Order.write_revision_number == order_revision,
        )
        .values(write_revision_number=order_revision + 1)
        .execution_options(synchronize_session=False)
    )
    if task_result.rowcount != 1 or order_result.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=409, detail="任务计划已变化，请刷新后重试")
    set_committed_value(task, "execution_revision_number", task_revision + 1)
    set_committed_value(task.order, "write_revision_number", order_revision + 1)
