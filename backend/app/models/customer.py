from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


if TYPE_CHECKING:
    from app.models.order import Order, OrderCat
    from app.models.payment import Payment
    from app.models.task import Task


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="latitude_range",
        ),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="longitude_range",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    seed_source: Mapped[str | None] = mapped_column(String(64), index=True)
    system_key: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    wechat_name: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(32), index=True)
    community: Mapped[str | None] = mapped_column(String(200), index=True)
    address: Mapped[str | None] = mapped_column(Text)
    building: Mapped[str | None] = mapped_column(String(50))
    unit: Mapped[str | None] = mapped_column(String(50))
    room: Mapped[str | None] = mapped_column(String(50))
    access_method: Mapped[str | None] = mapped_column(String(100))
    access_info: Mapped[str | None] = mapped_column(Text)
    key_status: Mapped[str | None] = mapped_column(String(50))
    key_code: Mapped[str | None] = mapped_column(String(100))
    is_repeat_customer: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    notes: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    geocode_status: Mapped[str | None] = mapped_column(String(32), index=True)
    geocode_fingerprint: Mapped[str | None] = mapped_column(String(64))
    geocode_adcode: Mapped[str | None] = mapped_column(String(20))
    geocode_level: Mapped[str | None] = mapped_column(String(32))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    cats: Mapped[list["Cat"]] = relationship(
        back_populates="customer",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    orders: Mapped[list["Order"]] = relationship(
        back_populates="customer",
        passive_deletes=True,
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="customer",
        passive_deletes=True,
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="customer",
        passive_deletes=True,
    )


class Cat(TimestampMixin, Base):
    __tablename__ = "cats"
    __table_args__ = (
        CheckConstraint("age IS NULL OR age >= 0", name="age_non_negative"),
        Index("ix_cats_customer_active", "customer_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    seed_source: Mapped[str | None] = mapped_column(String(64), index=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(500))
    gender: Mapped[str | None] = mapped_column(String(32))
    age: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    breed: Mapped[str | None] = mapped_column(String(100))
    personality: Mapped[str | None] = mapped_column(Text)
    food: Mapped[str | None] = mapped_column(Text)
    food_preference: Mapped[str | None] = mapped_column(Text)
    litter_type: Mapped[str | None] = mapped_column(String(100))
    medication_required: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    medication_notes: Mapped[str | None] = mapped_column(Text)
    special_notes: Mapped[str | None] = mapped_column(Text)
    service_notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )

    customer: Mapped[Customer] = relationship(back_populates="cats")
    order_links: Mapped[list["OrderCat"]] = relationship(
        back_populates="cat",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
