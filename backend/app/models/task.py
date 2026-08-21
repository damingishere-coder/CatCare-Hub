from datetime import date, datetime, time
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import TaskItemType, TaskStatus, portable_enum
from app.models.mixins import TimestampMixin


if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.order import Order


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("sort_order >= 0", name="sort_order_non_negative"),
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'ready', 'in_progress', 'completed', 'exception', 'cancelled')",
            name="status_values",
        ),
        CheckConstraint(
            "planned_lat IS NULL OR (planned_lat >= -90 AND planned_lat <= 90)",
            name="planned_lat_range",
        ),
        CheckConstraint(
            "planned_lng IS NULL OR (planned_lng >= -180 AND planned_lng <= 180)",
            name="planned_lng_range",
        ),
        Index("ix_tasks_service_date_sort", "service_date", "sort_order"),
        Index("ix_tasks_customer_date", "customer_id", "service_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    planned_time: Mapped[time | None] = mapped_column(Time)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    status: Mapped[TaskStatus] = mapped_column(
        portable_enum(TaskStatus, name="task_status", length=16),
        nullable=False,
        default=TaskStatus.PENDING,
        server_default=TaskStatus.PENDING.value,
        index=True,
    )
    planned_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    planned_lng: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    estimated_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    cat_status: Mapped[str | None] = mapped_column(Text)
    exception_notes: Mapped[str | None] = mapped_column(Text)

    order: Mapped["Order"] = relationship(back_populates="tasks")
    customer: Mapped["Customer"] = relationship(back_populates="tasks")
    items: Mapped[list["TaskItem"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    photos: Mapped[list["TaskPhoto"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class TaskItem(Base):
    __tablename__ = "task_items"
    __table_args__ = (
        CheckConstraint(
            "item_type IN ('feed', 'water', 'litter', 'canned_food', 'medicine', 'play', 'photo', 'other')",
            name="item_type_values",
        ),
        Index("ix_task_items_task_type", "task_id", "item_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_type: Mapped[TaskItemType] = mapped_column(
        portable_enum(TaskItemType, name="task_item_type", length=16),
        nullable=False,
    )
    required: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    task: Mapped[Task] = relationship(back_populates="items")


class TaskPhoto(Base):
    __tablename__ = "task_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    task: Mapped[Task] = relationship(back_populates="photos")
