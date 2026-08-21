from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.maps import GeoPoint, MapProviderError, MapServices, RouteResult, RouteStop
from app.models.enums import TaskStatus
from app.models.task import Task
from app.schemas.plan import (
    PlanGeoPoint,
    PlanMapProviderRead,
    PlanRouteIssue,
    PlanRouteMarker,
    PlanRoutePath,
    PlanRouteStart,
    PlanRouteWorkspace,
)
from app.services.orders import task_has_execution_history
from app.services.plans import (
    day_plan_revision,
    load_day_tasks,
    require_current_revision,
    schedule_is_locked,
)


VALID_CACHED_GEOCODE_STATUSES = {None, "manual", "resolved"}


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


def _geo_point(latitude: object, longitude: object) -> GeoPoint | None:
    if latitude is None or longitude is None:
        return None
    try:
        return GeoPoint(latitude=float(latitude), longitude=float(longitude))
    except (TypeError, ValueError):
        return None


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


def _geocode_address(task: Task) -> str | None:
    values: list[str] = []
    for value in (
        task.customer.community,
        task.customer.address,
        task.customer.building,
    ):
        normalized = value.strip() if value else ""
        if normalized and normalized not in values:
            values.append(normalized)
    return " ".join(values) or None


def _cached_task_point(task: Task) -> GeoPoint | None:
    task_point = _geo_point(task.planned_lat, task.planned_lng)
    if task_has_execution_history(task):
        return task_point
    if task.customer.geocode_status not in VALID_CACHED_GEOCODE_STATUSES:
        return None
    return task_point or _geo_point(task.customer.latitude, task.customer.longitude)


def _issue_for_task(task: Task) -> PlanRouteIssue:
    if task_has_execution_history(task):
        reason = "execution_location_missing"
    elif not _geocode_address(task):
        reason = "missing_address"
    elif task.customer.geocode_status == "failed":
        reason = "geocode_failed"
    else:
        reason = "not_geocoded"
    return PlanRouteIssue(
        task_id=task.id,
        customer_name=task.customer.name,
        community=task.customer.community,
        reason=reason,
    )


def _marker(
    task: Task,
    sequence: int,
    point: GeoPoint,
    services: MapServices,
) -> PlanRouteMarker:
    navigation_url: str | None
    try:
        navigation_url = services.navigation_provider.navigation_url(
            services.map_provider.home_point(),
            point,
            task.customer.community or task.customer.name,
        )
    except MapProviderError:
        navigation_url = None
    return PlanRouteMarker(
        task_id=task.id,
        sequence=sequence,
        customer_name=task.customer.name,
        community=task.customer.community,
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


def _empty_workspace(
    service_date: date,
    tasks: list[Task],
    services: MapServices,
) -> PlanRouteWorkspace:
    home = services.map_provider.home_point()
    markers: list[PlanRouteMarker] = []
    unresolved: list[PlanRouteIssue] = []
    sequence = 0
    for task in tasks:
        if task.status == TaskStatus.CANCELLED:
            continue
        sequence += 1
        point = _cached_task_point(task)
        if point is None:
            unresolved.append(_issue_for_task(task))
        else:
            markers.append(_marker(task, sequence, point, services))
    return PlanRouteWorkspace(
        service_date=service_date,
        revision=day_plan_revision(tasks),
        schedule_locked=schedule_is_locked(tasks),
        provider=_provider_read(services),
        start=(
            PlanRouteStart(label="家", position=_point_read(home))
            if home is not None
            else None
        ),
        markers=markers,
        unresolved_tasks=unresolved,
        current_route=None,
        recommended_route=None,
        recommended_task_ids=[],
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
    return _empty_workspace(service_date, tasks, services)


def _resolve_task_points(
    session: Session,
    tasks: list[Task],
    services: MapServices,
    *,
    geocode_missing: bool,
) -> None:
    resolved_customers: dict[int, GeoPoint | None] = {}
    changed = False
    for task in tasks:
        if task.status == TaskStatus.CANCELLED or task_has_execution_history(task):
            continue

        customer = task.customer
        if customer.id in resolved_customers:
            point = resolved_customers[customer.id]
        else:
            point = None
            if customer.geocode_status in VALID_CACHED_GEOCODE_STATUSES:
                point = _geo_point(customer.latitude, customer.longitude)
            if point is not None and customer.geocode_status is None:
                customer.geocode_status = "manual"
                changed = True
            if point is None and geocode_missing:
                address = _geocode_address(task)
                if address is None:
                    previous_state = (
                        customer.latitude,
                        customer.longitude,
                        customer.geocode_status,
                    )
                    customer.latitude = None
                    customer.longitude = None
                    customer.geocode_status = "missing"
                    changed = changed or previous_state != (None, None, "missing")
                else:
                    point = services.geocode_provider.geocode(address)
                    previous_state = (
                        customer.latitude,
                        customer.longitude,
                        customer.geocode_status,
                    )
                    if point is None:
                        customer.latitude = None
                        customer.longitude = None
                        customer.geocode_status = "failed"
                    else:
                        customer.latitude = Decimal(str(point.latitude))
                        customer.longitude = Decimal(str(point.longitude))
                        customer.geocode_status = "resolved"
                    changed = changed or previous_state != (
                        customer.latitude,
                        customer.longitude,
                        customer.geocode_status,
                    )
            resolved_customers[customer.id] = point

        if point is not None:
            latitude = Decimal(str(point.latitude))
            longitude = Decimal(str(point.longitude))
            if task.planned_lat != latitude or task.planned_lng != longitude:
                task.planned_lat = latitude
                task.planned_lng = longitude
                changed = True

    if changed:
        session.commit()
        session.expire_all()


def _route_stops(tasks: list[Task]) -> list[RouteStop]:
    stops: list[RouteStop] = []
    for index, task in enumerate(tasks):
        if task.status == TaskStatus.CANCELLED:
            continue
        point = _cached_task_point(task)
        if point is None:
            continue
        stops.append(
            RouteStop(
                task_id=task.id,
                label=task.customer.community or task.customer.name,
                position=point,
                original_index=index,
            )
        )
    return stops


def _merge_recommendation(
    tasks: list[Task],
    recommended: list[RouteStop],
) -> list[int]:
    recommended_ids = iter(stop.task_id for stop in recommended)
    return [
        task.id if task.status == TaskStatus.CANCELLED else next(recommended_ids)
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
        tasks = load_day_tasks(session, service_date)
        if _operational_state(tasks) != initial_operational_state:
            raise HTTPException(
                status_code=409,
                detail="路线生成期间当日计划已经变化，请刷新后重试",
            )
        workspace = _empty_workspace(service_date, tasks, services)
        route_revision = workspace.revision
        stops = _route_stops(tasks)
        if not stops:
            _require_route_state_unchanged(
                session,
                service_date,
                initial_operational_state,
                route_revision,
            )
            return workspace

        current_result = services.route_provider.plan_route(home, stops)
        workspace.current_route = _path_read(
            current_result,
            [stop.task_id for stop in stops],
        )

        if workspace.unresolved_tasks:
            _require_route_state_unchanged(
                session,
                service_date,
                initial_operational_state,
                route_revision,
            )
            return workspace

        recommended = services.route_provider.recommend_order(home, stops)
        current_ids = [stop.task_id for stop in stops]
        recommended_ids = [stop.task_id for stop in recommended]
        if (
            len(recommended_ids) != len(current_ids)
            or set(recommended_ids) != set(current_ids)
        ):
            raise MapProviderError("地图 Provider 返回了无效推荐顺序")
        recommended_result = (
            current_result
            if recommended_ids == current_ids
            else services.route_provider.plan_route(home, recommended)
        )
        workspace.recommended_route = _path_read(recommended_result, recommended_ids)
        workspace.recommended_task_ids = _merge_recommendation(tasks, recommended)
        workspace.can_adopt_recommendation = (
            not workspace.schedule_locked
            and workspace.recommended_task_ids != [task.id for task in tasks]
        )
        _require_route_state_unchanged(
            session,
            service_date,
            initial_operational_state,
            route_revision,
        )
        return workspace
    except MapProviderError as cause:
        session.rollback()
        raise HTTPException(status_code=502, detail=str(cause)) from cause
