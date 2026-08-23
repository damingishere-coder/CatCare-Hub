from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.maps import MapServices
from app.maps.factory import get_map_services
from app.models.order import Order, OrderCat
from app.models.task import Task
from app.schemas.plan import (
    DayPlanResponse,
    PlanCatDetail,
    PlanCatSummary,
    PlanCustomerDetail,
    PlanCustomerSummary,
    PlanDaySummary,
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
from app.services.plan_routes import load_route_workspace, preview_day_route
from app.services.plans import (
    apply_day_schedule,
    day_plan_revision,
    load_day_tasks,
    load_plan_task,
    schedule_is_locked,
    update_task_planning_status,
)
from app.services.route_recommendation import (
    OpenAIRouteRecommender,
    get_route_recommender,
)


router = APIRouter(prefix="/api/admin/plans", tags=["admin-plans"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]
RouteRecommenderDependency = Annotated[
    OpenAIRouteRecommender,
    Depends(get_route_recommender),
]


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


def _task_detail(task: Task, day_tasks: list[Task]) -> PlanTaskDetail:
    order = task.order
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
    )


@router.get("/days", response_model=PlanDaysResponse)
def list_plan_days(session: DatabaseSession) -> PlanDaysResponse:
    rows = session.execute(
        select(
            Task.service_date,
            func.count(distinct(Task.id)),
            func.count(distinct(Task.order_id)),
            func.count(distinct(OrderCat.cat_id)),
        )
        .outerjoin(OrderCat, OrderCat.order_id == Task.order_id)
        .group_by(Task.service_date)
        .order_by(Task.service_date)
    ).all()
    order_rows = session.execute(
        select(Task.service_date, Task.order_id).distinct()
    ).all()
    order_ids = {order_id for _, order_id in order_rows}
    order_counts = {
        order.id: order.cat_count
        for order in session.scalars(select(Order).where(Order.id.in_(order_ids))).all()
    }
    cat_counts_by_date: dict[date, int] = {}
    for service_date, order_id in order_rows:
        cat_counts_by_date[service_date] = (
            cat_counts_by_date.get(service_date, 0) + order_counts.get(order_id, 0)
        )
    items = [
        PlanDaySummary(
            service_date=service_date,
            task_count=int(task_count),
            order_count=int(order_count),
            cat_count=cat_counts_by_date.get(service_date, int(cat_count)),
        )
        for service_date, task_count, order_count, cat_count in rows
    ]
    return PlanDaysResponse(items=items, total=len(items))


@router.get("/tasks/{task_id}", response_model=PlanTaskDetail)
def get_plan_task(task_id: int, session: DatabaseSession) -> PlanTaskDetail:
    task = load_plan_task(session, task_id)
    return _task_detail(task, load_day_tasks(session, task.service_date))


@router.get("/{service_date}/route", response_model=PlanRouteWorkspace)
def get_plan_route(
    service_date: date,
    session: DatabaseSession,
    services: MapServicesDependency,
    recommender: RouteRecommenderDependency,
) -> PlanRouteWorkspace:
    return load_route_workspace(
        session,
        service_date=service_date,
        services=services,
        recommender=recommender,
    )


@router.post("/{service_date}/route/preview", response_model=PlanRouteWorkspace)
def preview_plan_route(
    service_date: date,
    payload: PlanRoutePreviewRequest,
    session: DatabaseSession,
    services: MapServicesDependency,
    recommender: RouteRecommenderDependency,
) -> PlanRouteWorkspace:
    return preview_day_route(
        session,
        service_date=service_date,
        expected_revision=payload.expected_revision,
        geocode_missing=payload.geocode_missing,
        services=services,
        recommender=recommender,
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
    return _task_detail(task, load_day_tasks(session, task.service_date))


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
