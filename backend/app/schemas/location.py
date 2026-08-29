from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.plan import PlanGeoPoint


class LocationWriteModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CustomerLocationUpdate(LocationWriteModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    coordinate_system: Literal["GCJ-02"]
    source_order_id: int = Field(gt=0)
    service_date: date
    expected_customer_updated_at: datetime
    expected_day_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class OrderLocationUpdate(LocationWriteModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    coordinate_system: Literal["GCJ-02"]
    service_date: date
    expected_order_updated_at: datetime
    expected_day_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class CustomerLocationRestore(LocationWriteModel):
    source_order_id: int = Field(gt=0)
    service_date: date
    expected_customer_updated_at: datetime
    expected_day_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class OrderLocationRestore(LocationWriteModel):
    service_date: date
    expected_order_updated_at: datetime
    expected_day_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class LocationUpdateRead(BaseModel):
    scope: Literal["customer", "order"]
    customer_id: int | None
    order_id: int
    original_position: PlanGeoPoint | None
    position: PlanGeoPoint
    affected_orders: int = Field(ge=0)
    affected_tasks: int = Field(ge=0)
    customer_updated_at: datetime | None
    order_updated_at: datetime
    day_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
