from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.maps import GeoPoint, MapProviderError, MapServices, RouteResult, RouteStop
from app.models.enums import TaskStatus
from app.models.task import Task
from app.schemas.plan import (
    PlanGeoPoint,
    PlanMapProviderRead,
    PlanRoadRoute,
    PlanRouteIssue,
    PlanRouteMarker,
    PlanRouteOptimization,
    PlanRoutePath,
    PlanRouteStart,
    PlanRouteWorkspace,
)
from app.services.order_locations import geocode_order, trusted_order_point
from app.services.orders import (
    order_display_address,
    order_geocode_address,
    task_has_execution_history,
)
from app.services.plans import (
    day_plan_revision,
    load_day_tasks,
    require_current_revision,
    schedule_is_locked,
)
from app.services.route_optimizer import RouteCandidate, optimize_closed_route


def _operational_state(tasks: list[Task]) -> tuple:
    return tuple(
        (
            task.id,
            task.order_id,
            task.planned_time.isoformat() if task.planned_time else None,
            task.sort_order,
            task.status.value,
            task.started_at.isoformat() if task.started_at else None,
            task.completed_at.isoformat() if task.completed_at else None,
            tuple(
                (item.id, item.item_type.value, item.required, item.completed)
                for item in sorted(task.items, key=lambda entry: entry.id)
            ),
            tuple(sorted(photo.id for photo in task.photos)),
        )
        for task in sorted(tasks, key=lambda entry: entry.id)
    )


def _require_route_state_unchanged(
    session: Session,
    service_date: date,
    initial_operational_state: tuple,
    route_revision: str,
) -> None:
    session.expire_all()
    latest_tasks = load_day_tasks(session, service_date)
    if (
        _operational_state(latest_tasks) != initial_operational_state
        or day_plan_revision(latest_tasks) != route_revision
    ):
        raise HTTPException(
            status_code=409,
            detail="路线生成期间当日计划已经变化，请刷新后重试",
        )


def _point_read(point: GeoPoint) -> PlanGeoPoint:
    return PlanGeoPoint(latitude=point.latitude, longitude=point.longitude)


def _provider_read(services: MapServices) -> PlanMapProviderRead:
    state = services.map_provider.provider_state()
    return PlanMapProviderRead(
        name=state.name,
        configured=state.configured,
        coordinate_system=state.coordinate_system,
        message=state.message,
    )


def _transport_mode(services: MapServices) -> str:
    return services.map_provider.provider_state().transport_mode


def _task_route_point(task: Task, services: MapServices) -> GeoPoint | None:
    if task_has_execution_history(task):
        if task.planned_lat is None or task.planned_lng is None:
            return None
        try:
            return GeoPoint(
                latitude=float(task.planned_lat),
                longitude=float(task.planned_lng),
            )
        except (TypeError, ValueError):
            return None
    return trusted_order_point(task.order, services)


def _issue_for_task(task: Task, services: MapServices) -> PlanRouteIssue:
    address = order_geocode_address(task.order)
    if not address:
        reason = "missing_address"
    elif task_has_execution_history(task):
        reason = "execution_location_missing"
    elif task.order.route_geocode_status == "geocode_mismatch":
        reason = "geocode_mismatch"
    elif task.order.route_geocode_status == "failed":
        reason = "geocode_failed"
    elif (
        task.order.route_latitude is not None
        and task.order.route_longitude is not None
        and trusted_order_point(task.order, services) is None
    ):
        reason = "stale_geocode"
    else:
        reason = "not_geocoded"
    return PlanRouteIssue(
        task_id=task.id,
        customer_name=task.order.contact_name,
        community=task.order.contact_community,
        address=order_display_address(task.order),
        reason=reason,
    )


def _marker(
    task: Task,
    sequence: int,
    point: GeoPoint,
    services: MapServices,
) -> PlanRouteMarker:
    try:
        navigation_url = services.navigation_provider.navigation_url(
            services.map_provider.home_point(),
            point,
            order_geocode_address(task.order) or f"任务 #{task.id}",
        )
    except MapProviderError:
        navigation_url = None
    return PlanRouteMarker(
        task_id=task.id,
        sequence=sequence,
        customer_name=task.order.contact_name,
        community=task.order.contact_community,
        address=order_display_address(task.order),
        position=_point_read(point),
        navigation_url=navigation_url,
    )


def _path_read(result: RouteResult, task_ids: list[int]) -> PlanRoutePath:
    return PlanRoutePath(
        task_ids=task_ids,
        distance_meters=result.distance_meters,
        duration_seconds=result.duration_seconds,
        polyline=[_point_read(point) for point in result.polyline],
    )


def _workspace(
    service_date: date,
    tasks: list[Task],
    services: MapServices,
    *,
    ordered_active_ids: list[int] | None = None,
) -> PlanRouteWorkspace:
    home = services.map_provider.home_point()
    active_tasks = [task for task in tasks if task.status != TaskStatus.CANCELLED]
    tasks_by_id = {task.id: task for task in active_tasks}
    ordered_tasks = (
        [tasks_by_id[task_id] for task_id in ordered_active_ids]
        if ordered_active_ids is not None
        else active_tasks
    )
    markers: list[PlanRouteMarker] = []
    unresolved: list[PlanRouteIssue] = []
    for sequence, task in enumerate(ordered_tasks, start=1):
        point = _task_route_point(task, services)
        if point is None:
            unresolved.append(_issue_for_task(task, services))
        else:
            markers.append(_marker(task, sequence, point, services))
    return PlanRouteWorkspace(
        service_date=service_date,
        revision=day_plan_revision(tasks),
        schedule_locked=schedule_is_locked(tasks),
        transport_mode=_transport_mode(services),
        provider=_provider_read(services),
        route_mode="round_trip",
        start=(
            PlanRouteStart(label="家", position=_point_read(home))
            if home is not None
            else None
        ),
        markers=markers,
        unresolved_tasks=unresolved,
        optimization=None,
        road_route=PlanRoadRoute(
            status="not_generated",
            path=None,
            message=None,
        ),
        can_adopt_recommendation=False,
    )


def load_route_workspace(
    session: Session,
    *,
    service_date: date,
    services: MapServices,
) -> PlanRouteWorkspace:
    tasks = load_day_tasks(session, service_date)
    if not tasks:
        raise HTTPException(status_code=404, detail="当天没有可规划任务")
    return _workspace(service_date, tasks, services)


def _resolve_task_points(
    session: Session,
    tasks: list[Task],
    services: MapServices,
    *,
    geocode_missing: bool,
) -> None:
    if not geocode_missing:
        return
    tasks_by_order: dict[int, list[Task]] = {}
    for task in tasks:
        if task.status != TaskStatus.CANCELLED:
            tasks_by_order.setdefault(task.order_id, []).append(task)
    for order_id, order_tasks in tasks_by_order.items():
        order = order_tasks[0].order
        if trusted_order_point(order, services) is not None:
            continue
        if all(task_has_execution_history(task) for task in order.tasks):
            continue
        geocode_order(
            session,
            order_id,
            services,
            raise_provider_errors=True,
        )
    session.expire_all()


def _route_candidates(tasks: list[Task], services: MapServices) -> list[RouteCandidate]:
    candidates: list[RouteCandidate] = []
    for original_index, task in enumerate(tasks):
        if task.status == TaskStatus.CANCELLED:
            continue
        point = _task_route_point(task, services)
        if point is None:
            continue
        candidates.append(
            RouteCandidate(
                task_id=task.id,
                position=point,
                original_index=original_index,
                planned_time=task.planned_time,
            )
        )
    return candidates


def _merged_schedule_task_ids(tasks: list[Task], optimized_ids: list[int]) -> list[int]:
    active_ids = iter(optimized_ids)
    return [
        task.id if task.status == TaskStatus.CANCELLED else next(active_ids)
        for task in tasks
    ]


def preview_day_route(
    session: Session,
    *,
    service_date: date,
    expected_revision: str,
    geocode_missing: bool,
    services: MapServices,
) -> PlanRouteWorkspace:
    tasks = load_day_tasks(session, service_date)
    if not tasks:
        raise HTTPException(status_code=404, detail="当天没有可规划任务")
    require_current_revision(tasks, expected_revision)
    initial_operational_state = _operational_state(tasks)

    state = services.map_provider.provider_state()
    home = services.map_provider.home_point()
    if not state.configured or home is None:
        raise HTTPException(status_code=503, detail=state.message or "地图服务尚未配置")

    try:
        _resolve_task_points(
            session,
            tasks,
            services,
            geocode_missing=geocode_missing,
        )
    except MapProviderError as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause
    tasks = load_day_tasks(session, service_date)
    if _operational_state(tasks) != initial_operational_state:
        raise HTTPException(
            status_code=409,
            detail="路线生成期间当日计划已经变化，请刷新后重试",
        )

    base_workspace = _workspace(service_date, tasks, services)
    route_revision = base_workspace.revision
    if base_workspace.unresolved_tasks:
        _require_route_state_unchanged(
            session,
            service_date,
            initial_operational_state,
            route_revision,
        )
        return base_workspace

    candidates = _route_candidates(tasks, services)
    optimization = optimize_closed_route(home, candidates)
    optimized_active_ids = [candidate.task_id for candidate in optimization.optimized]
    optimized_schedule_ids = _merged_schedule_task_ids(tasks, optimized_active_ids)
    workspace = _workspace(
        service_date,
        tasks,
        services,
        ordered_active_ids=optimized_active_ids,
    )
    workspace.optimization = PlanRouteOptimization(
        method=optimization.method,
        planned_time_policy="precedence",
        baseline_task_ids=[task.id for task in tasks],
        optimized_task_ids=optimized_schedule_ids,
        baseline_estimated_distance_meters=optimization.baseline_distance_meters,
        optimized_estimated_distance_meters=optimization.optimized_distance_meters,
        estimated_savings_percent=optimization.estimated_savings_percent,
    )
    workspace.can_adopt_recommendation = (
        not workspace.schedule_locked
        and optimized_schedule_ids != [task.id for task in tasks]
    )

    tasks_by_id = {task.id: task for task in tasks}
    route_stops = [
        RouteStop(
            task_id=candidate.task_id,
            label=order_geocode_address(tasks_by_id[candidate.task_id].order)
            or f"任务 #{candidate.task_id}",
            position=candidate.position,
            original_index=index,
        )
        for index, candidate in enumerate(optimization.optimized)
    ]
    route_stops.append(
        RouteStop(
            task_id=0,
            label="家",
            position=home,
            original_index=len(route_stops),
        )
    )
    try:
        road_result = services.route_provider.plan_route(home, route_stops)
    except MapProviderError as cause:
        workspace.road_route = PlanRoadRoute(
            status="degraded",
            path=None,
            message=f"顺序已完成本地规划；真实电动车道路暂不可用：{cause}",
        )
    else:
        workspace.road_route = PlanRoadRoute(
            status="ready",
            path=_path_read(road_result, optimized_active_ids),
            message="高德已计算优化顺序的真实电动车闭环路线",
        )

    _require_route_state_unchanged(
        session,
        service_date,
        initial_operational_state,
        route_revision,
    )
    return workspace
