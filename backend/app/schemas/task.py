from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import OrderStatus, TaskItemType, TaskStatus


class TaskWriteModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class TaskExecutionCustomer(BaseModel):
    id: int | None
    name: str
    phone: str | None
    community: str | None
    address: str | None
    building: str | None
    unit: str | None
    room: str | None
    access_method: str | None
    access_info: str | None
    key_status: str | None
    key_code: str | None


class TaskExecutionCat(BaseModel):
    id: int | None
    name: str
    food: str | None
    food_preference: str | None
    litter_type: str | None
    medication_required: bool
    medication_notes: str | None
    special_notes: str | None
    service_notes: str | None
    is_active: bool


class TaskExecutionItem(BaseModel):
    id: int
    item_type: TaskItemType
    required: bool
    completed: bool


class TaskExecutionPhoto(BaseModel):
    id: int
    url: str
    created_at: datetime


class TaskExecutionDetail(BaseModel):
    id: int
    order_id: int
    service_date: date
    planned_time: time | None
    status: TaskStatus
    started_at: datetime | None
    completed_at: datetime | None
    photos_sent_at: datetime | None
    notes: str | None
    cat_status: str | None
    exception_notes: str | None
    revision: str
    order_status: OrderStatus
    order_notes: str | None
    cat_count: int = Field(ge=1, le=50)
    customer: TaskExecutionCustomer
    cats: list[TaskExecutionCat]
    items: list[TaskExecutionItem]
    photos: list[TaskExecutionPhoto]


class TaskRevisionCommand(TaskWriteModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class TaskChecklistUpdate(TaskRevisionCommand):
    completed: bool


class TaskTextUpdate(TaskRevisionCommand):
    notes: str | None = Field(default=None, max_length=4000)
    cat_status: str | None = Field(default=None, max_length=4000)


class TaskExceptionCommand(TaskRevisionCommand):
    exception_notes: str = Field(min_length=1, max_length=4000)
