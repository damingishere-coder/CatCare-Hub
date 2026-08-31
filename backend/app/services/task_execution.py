import hashlib
import json
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.models.enums import OrderStatus, TaskItemType, TaskStatus
from app.models.order import Order, OrderCat
from app.models.task import Task, TaskItem, TaskPhoto
from app.schemas.task import (
    TaskExecutionCat,
    TaskExecutionCustomer,
    TaskExecutionDetail,
    TaskExecutionItem,
    TaskExecutionPhoto,
)
from app.services.business_time import as_utc
from app.services.task_uploads import (
    UploadValidationError,
    delete_stored_photo,
    persist_uploaded_image,
    validate_uploaded_image,
)


STARTABLE_STATUSES = {TaskStatus.CONFIRMED, TaskStatus.READY}
TERMINAL_STATUSES = {
    TaskStatus.COMPLETED,
    TaskStatus.EXCEPTION,
    TaskStatus.CANCELLED,
}


def _task_load_options() -> tuple:
    return (
        selectinload(Task.items),
        selectinload(Task.photos),
        selectinload(Task.order).selectinload(Order.tasks),
        selectinload(Task.order).selectinload(Order.cat_links).selectinload(OrderCat.cat),
    )


def load_execution_task(session: Session, task_id: int) -> Task:
    task = session.scalar(
        select(Task).where(Task.id == task_id).options(*_task_load_options())
    )
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


def _datetime_value(value: datetime | None) -> str | None:
    normalized = as_utc(value)
    return normalized.isoformat() if normalized else None


def execution_revision(task: Task) -> str:
    payload = {
        "task": {
            "id": task.id,
            "status": task.status.value,
            "started_at": _datetime_value(task.started_at),
            "completed_at": _datetime_value(task.completed_at),
            "photos_sent_at": _datetime_value(task.photos_sent_at),
            "notes": task.notes,
            "cat_status": task.cat_status,
            "exception_notes": task.exception_notes,
            "updated_at": _datetime_value(task.updated_at),
            "revision_number": task.execution_revision_number,
        },
        "order": {
            "id": task.order.id,
            "status": task.order.order_status.value,
            "updated_at": _datetime_value(task.order.updated_at),
            "write_revision_number": task.order.write_revision_number,
        },
        "items": [
            {
                "id": item.id,
                "type": item.item_type.value,
                "required": item.required,
                "completed": item.completed,
            }
            for item in sorted(task.items, key=lambda entry: entry.id)
        ],
        "photos": [
            {
                "id": photo.id,
                "file_url": photo.file_url,
                "created_at": _datetime_value(photo.created_at),
            }
            for photo in sorted(task.photos, key=lambda entry: entry.id)
        ],
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def require_execution_revision(task: Task, expected_revision: str) -> None:
    if execution_revision(task) != expected_revision:
        raise HTTPException(
            status_code=409,
            detail="任务执行记录已在其他页面更新，请刷新后重试",
        )


def reserve_execution_revision(
    session: Session,
    task: Task,
    expected_revision: str,
) -> None:
    """Reserve both task and order versions before changing execution state."""

    require_execution_revision(task, expected_revision)
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
        raise HTTPException(
            status_code=409,
            detail="任务或订单已在其他页面更新，请刷新后重试",
        )
    set_committed_value(task, "execution_revision_number", task_revision + 1)
    set_committed_value(task.order, "write_revision_number", order_revision + 1)


def task_execution_detail(task: Task) -> TaskExecutionDetail:
    order = task.order
    return TaskExecutionDetail(
        id=task.id,
        order_id=task.order_id,
        service_date=task.service_date,
        planned_time=task.planned_time,
        status=task.status,
        started_at=as_utc(task.started_at),
        completed_at=as_utc(task.completed_at),
        photos_sent_at=as_utc(task.photos_sent_at),
        notes=task.notes,
        cat_status=task.cat_status,
        exception_notes=task.exception_notes,
        revision=execution_revision(task),
        order_status=task.order.order_status,
        order_notes=task.order.notes,
        cat_count=task.order.cat_count,
        customer=TaskExecutionCustomer(
            id=order.customer_id,
            name=order.contact_name,
            phone=order.contact_phone,
            community=order.contact_community,
            address=order.contact_address,
            building=order.contact_building,
            unit=order.contact_unit,
            room=order.contact_room,
            access_method=order.contact_access_method,
            community_access_method=order.contact_community_access_method,
            building_access_method=order.contact_building_access_method,
            access_info=order.contact_access_info,
            key_status=order.contact_key_status,
            key_code=order.contact_key_code,
        ),
        cats=(
            [
                TaskExecutionCat(
                    id=item.get("source_cat_id"),
                    name=str(item.get("name") or f"猫咪 {index + 1}"),
                    food=item.get("food"),
                    food_preference=item.get("food_preference"),
                    litter_type=item.get("litter_type"),
                    medication_required=bool(
                        item.get("medication_required", False)
                    ),
                    medication_notes=item.get("medication_notes"),
                    special_notes=item.get("special_notes"),
                    service_notes=item.get("service_notes"),
                    is_active=True,
                )
                for index, item in enumerate(order.cat_snapshot)
            ]
            if order.cat_snapshot
            else [
                TaskExecutionCat(
                    id=link.cat.id,
                    name=link.cat.name,
                    food=link.cat.food,
                    food_preference=link.cat.food_preference,
                    litter_type=link.cat.litter_type,
                    medication_required=link.cat.medication_required,
                    medication_notes=link.cat.medication_notes,
                    special_notes=link.cat.special_notes,
                    service_notes=link.cat.service_notes,
                    is_active=link.cat.is_active,
                )
                for link in sorted(order.cat_links, key=lambda entry: entry.cat_id)
            ]
        ),
        items=[
            TaskExecutionItem(
                id=item.id,
                item_type=item.item_type,
                required=item.required,
                completed=item.completed,
            )
            for item in sorted(task.items, key=lambda entry: entry.id)
        ],
        photos=[
            TaskExecutionPhoto(
                id=photo.id,
                url=f"/api/admin/tasks/{task.id}/photos/{photo.id}",
                created_at=as_utc(photo.created_at),
            )
            for photo in sorted(task.photos, key=lambda entry: entry.id)
        ],
    )


def get_execution_detail(session: Session, task_id: int) -> TaskExecutionDetail:
    return task_execution_detail(load_execution_task(session, task_id))


def _commit_and_reload(session: Session, task: Task) -> TaskExecutionDetail:
    session.commit()
    session.expire_all()
    return task_execution_detail(load_execution_task(session, task.id))


def _require_in_progress(task: Task) -> None:
    if task.status is not TaskStatus.IN_PROGRESS:
        if task.status in TERMINAL_STATUSES:
            detail = "已完成、异常或取消的任务不可继续修改"
        else:
            detail = "请先开始任务再记录执行内容"
        raise HTTPException(status_code=409, detail=detail)


def _sync_order_progress(order: Order) -> None:
    if order.order_status is OrderStatus.CANCELLED:
        return
    active_tasks = [task for task in order.tasks if task.status is not TaskStatus.CANCELLED]
    if active_tasks and all(task.status is TaskStatus.COMPLETED for task in active_tasks):
        order.order_status = OrderStatus.COMPLETED
    else:
        order.order_status = OrderStatus.IN_PROGRESS


def start_task(
    session: Session,
    task_id: int,
    expected_revision: str,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    if task.order.order_status in {
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CANCELLED,
        OrderStatus.COMPLETED,
    }:
        raise HTTPException(status_code=409, detail="订单尚未确认、已取消或已完成")
    if task.status not in STARTABLE_STATUSES:
        raise HTTPException(status_code=409, detail="只有已确认或待出发任务可以开始")

    reserve_execution_revision(session, task, expected_revision)
    task.status = TaskStatus.IN_PROGRESS
    task.started_at = datetime.now(timezone.utc)
    task.completed_at = None
    _sync_order_progress(task.order)
    return _commit_and_reload(session, task)


def update_task_item(
    session: Session,
    task_id: int,
    item_id: int,
    expected_revision: str,
    completed: bool,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    item = next((entry for entry in task.items if entry.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="服务事项不存在或不属于该任务")
    if item.item_type is TaskItemType.PHOTO:
        raise HTTPException(status_code=409, detail="拍照事项由实际上传图片自动完成")
    if item.completed == completed:
        return task_execution_detail(task)
    reserve_execution_revision(session, task, expected_revision)
    item.completed = completed
    return _commit_and_reload(session, task)


def update_task_text(
    session: Session,
    task_id: int,
    expected_revision: str,
    *,
    notes: str | None,
    cat_status: str | None,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    if task.notes == notes and task.cat_status == cat_status:
        return task_execution_detail(task)
    reserve_execution_revision(session, task, expected_revision)
    task.notes = notes
    task.cat_status = cat_status
    return _commit_and_reload(session, task)


async def add_task_photo(
    session: Session,
    task_id: int,
    expected_revision: str,
    upload: UploadFile,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    try:
        image = await validate_uploaded_image(upload)
    except UploadValidationError as cause:
        raise HTTPException(status_code=cause.status_code, detail=str(cause)) from cause

    session.expire_all()
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    reserve_execution_revision(session, task, expected_revision)
    file_url = persist_uploaded_image(image, task.service_date)
    try:
        task.photos.append(TaskPhoto(file_url=file_url))
        for item in task.items:
            if item.item_type is TaskItemType.PHOTO:
                item.completed = True
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        delete_stored_photo(file_url)
        raise
    session.expire_all()
    return task_execution_detail(load_execution_task(session, task_id))


def complete_task(
    session: Session,
    task_id: int,
    expected_revision: str,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    missing = [item.item_type.value for item in task.items if item.required and not item.completed]
    if missing:
        raise HTTPException(status_code=409, detail="请先完成所有必做服务事项")
    if any(item.required and item.item_type is TaskItemType.PHOTO for item in task.items):
        if not task.photos:
            raise HTTPException(status_code=409, detail="必做拍照事项需要至少上传一张图片")

    reserve_execution_revision(session, task, expected_revision)
    task.status = TaskStatus.COMPLETED
    task.completed_at = datetime.now(timezone.utc)
    _sync_order_progress(task.order)
    return _commit_and_reload(session, task)


def mark_task_exception(
    session: Session,
    task_id: int,
    expected_revision: str,
    exception_notes: str,
) -> TaskExecutionDetail:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    _require_in_progress(task)
    reserve_execution_revision(session, task, expected_revision)
    task.exception_notes = exception_notes
    task.status = TaskStatus.EXCEPTION
    task.completed_at = datetime.now(timezone.utc)
    _sync_order_progress(task.order)
    return _commit_and_reload(session, task)


def load_task_photo(session: Session, task_id: int, photo_id: int) -> TaskPhoto:
    photo = session.scalar(
        select(TaskPhoto).where(
            TaskPhoto.id == photo_id,
            TaskPhoto.task_id == task_id,
        )
    )
    if photo is None:
        raise HTTPException(status_code=404, detail="任务照片不存在")
    return photo
