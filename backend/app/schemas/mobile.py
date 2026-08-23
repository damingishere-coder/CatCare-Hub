from datetime import date, time
from typing import Literal

from pydantic import BaseModel

from app.models.enums import TaskStatus
from app.schemas.task import TaskExecutionDetail


NavigationState = Literal["ready", "missing_coordinates", "provider_unavailable"]


class MobileTodayTask(BaseModel):
    id: int
    order_id: int
    sequence: int
    sort_order: int
    planned_time: time | None
    status: TaskStatus
    customer_name: str
    community: str | None
    address: str | None
    cat_count: int
    navigation_url: str | None
    navigation_state: NavigationState


class MobileTodayRead(BaseModel):
    business_date: date
    task_count: int
    open_task_count: int
    completed_task_count: int
    tasks: list[MobileTodayTask]


class MobileTaskExecutionDetail(TaskExecutionDetail):
    navigation_url: str | None
    navigation_state: NavigationState
