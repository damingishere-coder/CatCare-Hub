from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.maps import MapServices
from app.maps.factory import get_map_services
from app.models.order import Order
from app.models.enums import OrderStatus, TaskStatus
from app.models.task import Task
from app.schemas.plan import (
    DayPlanResponse,
    PlanCatDetail,
    PlanCatSummary,
    PlanCustomerDetail,
    PlanCustomerSummary,
    PlanDaySummary,
    PlanDayOrderMarker,
    PlanDaysResponse,
    PlanRoutePreviewRequest,
    PlanRouteWorkspace,
    PlanScheduleUpdate,
    PlanTaskDetail,
    PlanTaskItemRead,
    PlanTaskStatusUpdate,
    PlanTaskSummary,
)
from app.services.orders import order_display_address, task_has_execution_history
from app.services.manual_locations import location_impact
from app.services.plan_routes import load_route_workspace, preview_day_route
from app.services.plans import (
    apply_day_schedule,
    day_plan_revision,
    load_day_tasks,
    load_plan_task,
    schedule_is_locked,
    update_task_planning_status,
)


router = APIRouter(prefix="/api/admin/plans", tags=["admin-plans"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]


def _cat_summaries(task: Task) -> list[PlanCatSummary]:
    if task.order.cat_snapshot:
        return [
            PlanCatSummary(
                id=item.get("source_cat_id"),
                name=str(item.get("name") or f"猫咪 {index + 1}"),
            )
            for index, item in enumerate(task.order.cat_snapshot)
        ]
    return [
        PlanCatSummary(id=link.cat.id, name=link.cat.name)
        for link in sorted(task.order.cat_links, key=lambda entry: entry.cat_id)
    ]


def _task_summary(task: Task) -> PlanTaskSummary:
    return PlanTaskSummary(
        id=task.id,
        order_id=task.order_id,
        order_number=task.order.order_number,
        service_date=task.service_date,
        planned_time=task.planned_time,
        sort_order=task.sort_order,
        status=task.status,
        customer=PlanCustomerSummary(
            id=task.order.customer_id,
            name=task.order.contact_name,
            community=task.order.contact_community,
            address=order_display_address(task.order),
        ),
        cat_count=task.order.cat_count,
        cats=_cat_summaries(task),
        items=[
            PlanTaskItemRead(
                item_type=item.item_type,
                required=item.required,
                completed=item.completed,
            )
            for item in sorted(task.items, key=lambda entry: entry.id)
        ],
        has_execution_history=task_has_execution_history(task),
    )


def _day_plan(service_date: date, tasks: list[Task]) -> DayPlanResponse:
    order_ids = {task.order_id for task in tasks}
    orders = {task.order_id: task.order for task in tasks}
    return DayPlanResponse(
        service_date=service_date,
        task_count=len(tasks),
        order_count=len(order_ids),
        cat_count=sum(order.cat_count for order in orders.values()),
        revision=day_plan_revision(tasks),
        schedule_locked=schedule_is_locked(tasks),
        tasks=[_task_summary(task) for task in tasks],
    )


def _task_detail(session: Session, task: Task, day_tasks: list[Task]) -> PlanTaskDetail:
    order = task.order
    location_scope, sync_order_count, sync_task_count, customer_updated_at = (
        location_impact(session, order)
    )
    return PlanTaskDetail(
        task=_task_summary(task),
        day_revision=day_plan_revision(day_tasks),
        customer=PlanCustomerDetail(
            id=order.customer_id,
            name=order.contact_name,
            community=order.contact_community,
            address=order.contact_address,
            building=order.contact_building,
            unit=order.contact_unit,
            room=order.contact_room,
            updated_at=customer_updated_at,
        ),
        cats=(
            [
                PlanCatDetail(
                    id=item.get("source_cat_id"),
                    name=str(item.get("name") or f"猫咪 {index + 1}"),
                    is_active=True,
                    medication_required=bool(item.get("medication_required", False)),
                    medication_notes=item.get("medication_notes"),
                    special_notes=item.get("special_notes"),
                    service_notes=item.get("service_notes"),
                )
                for index, item in enumerate(order.cat_snapshot)
            ]
            if order.cat_snapshot
            else [
                PlanCatDetail(
                    id=link.cat.id,
                    name=link.cat.name,
                    is_active=link.cat.is_active,
                    medication_required=link.cat.medication_required,
                    medication_notes=link.cat.medication_notes,
                    special_notes=link.cat.special_notes,
                    service_notes=link.cat.service_notes,
                )
                for link in sorted(order.cat_links, key=lambda entry: entry.cat_id)
            ]
        ),
        order_status=task.order.order_status,
        payment_status=task.order.payment_status,
        order_notes=task.order.notes,
        task_notes=task.notes,
        estimated_arrival=task.estimated_arrival,
        photo_count=len(task.photos),
        order_updated_at=order.updated_at,
        route_geocode_status=order.route_geocode_status,
        current_position=(
            {"latitude": float(order.route_latitude), "longitude": float(order.route_longitude)}
            if order.route_latitude is not None and order.route_longitude is not None
            else None
        ),
        location_scope=location_scope,
        location_sync_order_count=sync_order_count,
        location_sync_task_count=sync_task_count,
    )


@router.get("/days", response_model=PlanDaysResponse, response_model_exclude_none=True)
def list_plan_days(
    session: DatabaseSession,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> PlanDaysResponse:
    if (date_from is None) != (date_to is None):
        raise HTTPException(status_code=422, detail="date_from 和 date_to 必须成对提供")
    if date_from is not None and date_to is not None:
        if date_to < date_from:
            raise HTTPException(status_code=422, detail="date_to 不能早于 date_from")
        if (date_to - date_from).days > 61:
            raise HTTPException(status_code=422, detail="日期范围最多 62 天")
    statement = (
        select(Task)
        .join(Order, Order.id == Task.order_id)
        .options(selectinload(Task.order))
        .where(
            Task.status != TaskStatus.CANCELLED,
            Order.order_status != OrderStatus.CANCELLED,
        )
        .order_by(Task.service_date, Task.sort_order, Task.id)
    )
    if date_from is not None and date_to is not None:
        statement = statement.where(Task.service_date.between(date_from, date_to))
    tasks = list(session.scalars(statement).unique().all())
    tasks_by_date: dict[date, list[Task]] = {}
    for task in tasks:
        tasks_by_date.setdefault(task.service_date, []).append(task)
    items: list[PlanDaySummary] = []
    for service_date, day_tasks in tasks_by_date.items():
        order_tasks: dict[int, list[Task]] = {}
        for task in day_tasks:
            order_tasks.setdefault(task.order_id, []).append(task)
        orders = [entries[0].order for entries in order_tasks.values()]
        items.append(
            PlanDaySummary(
                service_date=service_date,
                task_count=len(day_tasks),
                order_count=len(order_tasks),
                cat_count=sum(order.cat_count for order in orders),
                customer_names=list(dict.fromkeys(order.contact_name for order in orders)),
                orders=(
                    [
                        PlanDayOrderMarker(
                            order_id=order_id,
                            order_number=entries[0].order.order_number,
                            customer_name=entries[0].order.contact_name,
                            visit_count=len(entries),
                            order_status=entries[0].order.order_status,
                        )
                        for order_id, entries in order_tasks.items()
                    ]
                    if date_from is not None
                    else None
                ),
            )
        )
    return PlanDaysResponse(items=items, total=len(items))


@router.get("/tasks/{task_id}", response_model=PlanTaskDetail)
def get_plan_task(task_id: int, session: DatabaseSession) -> PlanTaskDetail:
    task = load_plan_task(session, task_id)
    return _task_detail(session, task, load_day_tasks(session, task.service_date))


@router.get("/{service_date}/route", response_model=PlanRouteWorkspace)
def get_plan_route(
    service_date: date,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> PlanRouteWorkspace:
    return load_route_workspace(
        session,
        service_date=service_date,
        services=services,
    )


@router.post("/{service_date}/route/preview", response_model=PlanRouteWorkspace)
def preview_plan_route(
    service_date: date,
    payload: PlanRoutePreviewRequest,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> PlanRouteWorkspace:
    return preview_day_route(
        session,
        service_date=service_date,
        expected_revision=payload.expected_revision,
        geocode_missing=payload.geocode_missing,
        services=services,
    )


@router.patch("/tasks/{task_id}/status", response_model=PlanTaskDetail)
def change_plan_task_status(
    task_id: int,
    payload: PlanTaskStatusUpdate,
    session: DatabaseSession,
) -> PlanTaskDetail:
    task = update_task_planning_status(
        session,
        task_id=task_id,
        expected_revision=payload.expected_revision,
        task_status=payload.task_status,
    )
    return _task_detail(session, task, load_day_tasks(session, task.service_date))


@router.get("/{service_date}", response_model=DayPlanResponse)
def get_day_plan(service_date: date, session: DatabaseSession) -> DayPlanResponse:
    return _day_plan(service_date, load_day_tasks(session, service_date))


@router.put("/{service_date}/schedule", response_model=DayPlanResponse)
def save_day_schedule(
    service_date: date,
    payload: PlanScheduleUpdate,
    session: DatabaseSession,
) -> DayPlanResponse:
    tasks = apply_day_schedule(
        session,
        service_date=service_date,
        expected_revision=payload.expected_revision,
        schedule=payload.tasks,
    )
    return _day_plan(service_date, tasks)
