from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import TaskStatus


DashboardReminderType = Literal[
    "key_pickup",
    "medicine",
    "photos_pending",
    "payment_due",
    "last_service",
    "order_starts_tomorrow",
]


class DashboardMetrics(BaseModel):
    month_order_count: int = Field(ge=0)
    pending_task_count: int = Field(ge=0)
    pending_payment_count: int = Field(ge=0)
    month_income: Decimal = Field(ge=0)


class DashboardTaskSummary(BaseModel):
    id: int
    order_id: int
    planned_time: time | None
    sort_order: int
    status: TaskStatus
    customer_name: str
    community: str | None
    address: str | None
    cat_count: int = Field(ge=0)


class DashboardReminder(BaseModel):
    id: str
    kind: DashboardReminderType
    customer_name: str
    message: str
    task_id: int | None = None
    order_id: int | None = None
    cat_count: int | None = Field(default=None, ge=0)
    amount: Decimal | None = Field(default=None, ge=0)
    expected_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class DashboardResponse(BaseModel):
    business_date: date
    month_start: date
    metrics: DashboardMetrics
    schedule: list[DashboardTaskSummary]
    reminders: list[DashboardReminder]


class DashboardPhotoSent(BaseModel):
    task_id: int
    photos_sent_at: datetime
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")
