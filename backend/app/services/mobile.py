from datetime import date

from sqlalchemy.orm import Session

from app.maps import MapServices
from app.models.enums import OrderStatus, TaskStatus
from app.schemas.mobile import (
    MobileTaskExecutionDetail,
    MobileTodayRead,
    MobileTodayTask,
    NavigationState,
)
from app.schemas.task import TaskExecutionDetail
from app.services.plan_routes import load_route_workspace
from app.services.plans import load_day_tasks
from app.services.orders import order_display_address


MOBILE_TERMINAL_STATUSES = {TaskStatus.COMPLETED, TaskStatus.EXCEPTION}


def _navigation_state(
    navigation_url: str | None,
    *,
    has_marker: bool,
) -> NavigationState:
    if navigation_url:
        return "ready"
    return "provider_unavailable" if has_marker else "missing_coordinates"


def load_mobile_today(
    session: Session,
    *,
    service_date: date,
    services: MapServices,
) -> MobileTodayRead:
    """Build a privacy-minimized mobile itinerary without network map calls."""

    day_tasks = load_day_tasks(session, service_date)
    tasks = [
        task
        for task in day_tasks
        if task.status is not TaskStatus.CANCELLED
        and task.order.order_status is not OrderStatus.CANCELLED
    ]

    markers_by_task_id = {}
    if day_tasks:
        workspace = load_route_workspace(
            session,
            service_date=service_date,
            services=services,
        )
        markers_by_task_id = {marker.task_id: marker for marker in workspace.markers}

    summaries: list[MobileTodayTask] = []
    for sequence, task in enumerate(tasks, start=1):
        marker = markers_by_task_id.get(task.id)
        navigation_url = marker.navigation_url if marker else None
        summaries.append(
            MobileTodayTask(
                id=task.id,
                order_id=task.order_id,
                order_number=task.order.order_number,
                sequence=sequence,
                sort_order=task.sort_order,
                planned_time=task.planned_time,
                status=task.status,
                customer_name=task.order.contact_name,
                community=task.order.contact_community,
                address=order_display_address(task.order),
                cat_count=task.order.cat_count,
                navigation_url=navigation_url,
                navigation_state=_navigation_state(
                    navigation_url,
                    has_marker=marker is not None,
                ),
            )
        )

    return MobileTodayRead(
        business_date=service_date,
        task_count=len(summaries),
        open_task_count=sum(
            task.status not in MOBILE_TERMINAL_STATUSES for task in tasks
        ),
        completed_task_count=sum(
            task.status is TaskStatus.COMPLETED for task in tasks
        ),
        tasks=summaries,
    )


def mobile_execution_detail(
    session: Session,
    detail: TaskExecutionDetail,
    *,
    services: MapServices,
) -> MobileTaskExecutionDetail:
    workspace = load_route_workspace(
        session,
        service_date=detail.service_date,
        services=services,
    )
    marker = next(
        (entry for entry in workspace.markers if entry.task_id == detail.id),
        None,
    )
    navigation_url = marker.navigation_url if marker else None
    payload = detail.model_dump()
    payload["photos"] = [
        photo.model_copy(
            update={"url": f"/api/mobile/tasks/{detail.id}/photos/{photo.id}"}
        )
        for photo in detail.photos
    ]
    return MobileTaskExecutionDetail(
        **payload,
        navigation_url=navigation_url,
        navigation_state=_navigation_state(
            navigation_url,
            has_marker=marker is not None,
        ),
    )
