from datetime import date, datetime, time
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import OrderPaymentStatus, OrderStatus, TaskItemType, TaskStatus


class PlanWriteModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanCustomerSummary(BaseModel):
    id: int
    name: str
    community: str | None


class PlanCustomerDetail(PlanCustomerSummary):
    address: str | None
    building: str | None
    unit: str | None
    room: str | None


class PlanCatSummary(BaseModel):
    id: int
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
    cats: list[PlanCatSummary]
    items: list[PlanTaskItemRead]
    has_execution_history: bool


class PlanDaySummary(BaseModel):
    service_date: date
    task_count: int
    order_count: int
    cat_count: int


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
