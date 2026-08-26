from datetime import date, datetime, time
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import OrderPaymentStatus, OrderStatus, TaskItemType, TaskStatus


class PlanWriteModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanCustomerSummary(BaseModel):
    id: int | None
    name: str
    community: str | None
    address: str | None


class PlanCustomerDetail(PlanCustomerSummary):
    building: str | None
    unit: str | None
    room: str | None


class PlanCatSummary(BaseModel):
    id: int | None
    name: str


class PlanCatDetail(PlanCatSummary):
    is_active: bool
    medication_required: bool
    medication_notes: str | None
    special_notes: str | None
    service_notes: str | None


class PlanTaskItemRead(BaseModel):
    item_type: TaskItemType
    required: bool
    completed: bool


class PlanTaskSummary(BaseModel):
    id: int
    order_id: int
    service_date: date
    planned_time: time | None
    sort_order: int
    status: TaskStatus
    customer: PlanCustomerSummary
    cat_count: int = Field(ge=1, le=50)
    cats: list[PlanCatSummary]
    items: list[PlanTaskItemRead]
    has_execution_history: bool


class PlanDaySummary(BaseModel):
    service_date: date
    task_count: int
    order_count: int
    cat_count: int
    customer_names: list[str]


class PlanDaysResponse(BaseModel):
    items: list[PlanDaySummary]
    total: int


class DayPlanResponse(BaseModel):
    service_date: date
    task_count: int
    order_count: int
    cat_count: int
    revision: str
    schedule_locked: bool
    tasks: list[PlanTaskSummary]


class PlanTaskDetail(BaseModel):
    task: PlanTaskSummary
    day_revision: str
    customer: PlanCustomerDetail
    cats: list[PlanCatDetail]
    order_status: OrderStatus
    payment_status: OrderPaymentStatus
    order_notes: str | None
    task_notes: str | None
    estimated_arrival: datetime | None
    photo_count: int


class PlanScheduleItem(PlanWriteModel):
    task_id: int = Field(gt=0)
    planned_time: time | None = None


class PlanScheduleUpdate(PlanWriteModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    tasks: list[PlanScheduleItem] = Field(min_length=1, max_length=1000)

    @field_validator("tasks")
    @classmethod
    def reject_duplicate_tasks(
        cls,
        tasks: list[PlanScheduleItem],
    ) -> list[PlanScheduleItem]:
        task_ids = [task.task_id for task in tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("同一天的排程不能重复包含任务")
        return tasks


class PlanTaskStatusUpdate(PlanWriteModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    task_status: TaskStatus


class PlanGeoPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PlanMapProviderRead(BaseModel):
    name: str
    configured: bool
    coordinate_system: str
    message: str | None


class PlanRouteStart(BaseModel):
    label: str
    position: PlanGeoPoint


class PlanRouteMarker(BaseModel):
    task_id: int
    sequence: int
    customer_name: str
    community: str | None
    address: str | None
    position: PlanGeoPoint
    navigation_url: str | None


class PlanRouteIssue(BaseModel):
    task_id: int
    customer_name: str
    community: str | None
    address: str | None
    reason: Literal[
        "missing_address",
        "not_geocoded",
        "geocode_failed",
        "stale_geocode",
        "geocode_mismatch",
        "execution_location_missing",
    ]


class PlanRoutePath(BaseModel):
    task_ids: list[int]
    distance_meters: int = Field(ge=0)
    duration_seconds: int = Field(ge=0)
    polyline: list[PlanGeoPoint]


class PlanRouteOptimization(BaseModel):
    method: Literal["exact", "two_opt", "none"]
    planned_time_policy: Literal["precedence"] = "precedence"
    baseline_task_ids: list[int]
    optimized_task_ids: list[int]
    baseline_estimated_distance_meters: int = Field(ge=0)
    optimized_estimated_distance_meters: int = Field(ge=0)
    estimated_savings_percent: float


class PlanRoadRoute(BaseModel):
    status: Literal["not_generated", "ready", "degraded"]
    path: PlanRoutePath | None
    message: str | None


class PlanRouteWorkspace(BaseModel):
    service_date: date
    revision: str
    schedule_locked: bool
    transport_mode: Literal["electrobike", "unknown"]
    provider: PlanMapProviderRead
    route_mode: Literal["round_trip"] = "round_trip"
    start: PlanRouteStart | None
    markers: list[PlanRouteMarker]
    unresolved_tasks: list[PlanRouteIssue]
    optimization: PlanRouteOptimization | None
    road_route: PlanRoadRoute
    can_adopt_recommendation: bool


class PlanRoutePreviewRequest(PlanWriteModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    geocode_missing: bool = True
