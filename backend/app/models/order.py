from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import (
    OrderAdjustmentType,
    OrderPaymentStatus,
    OrderSettlementMode,
    OrderStatus,
    portable_enum,
)
from app.models.mixins import TimestampMixin


if TYPE_CHECKING:
    from app.models.customer import Cat, Customer
    from app.models.payment import Payment
    from app.models.task import Task


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="valid_date_range"),
        CheckConstraint("visits_per_day > 0", name="visits_per_day_positive"),
        CheckConstraint("base_price >= 0", name="base_price_non_negative"),
        CheckConstraint("extra_cat_fee >= 0", name="extra_cat_fee_non_negative"),
        CheckConstraint("stairs_fee >= 0", name="stairs_fee_non_negative"),
        CheckConstraint("other_fee >= 0", name="other_fee_non_negative"),
        CheckConstraint("total_amount >= 0", name="total_amount_non_negative"),
        CheckConstraint("paid_amount >= 0", name="paid_amount_non_negative"),
        CheckConstraint(
            "settlement_mode IN ('daily', 'order_total')",
            name="settlement_mode_values",
        ),
        CheckConstraint(
            "adjustment_type IN ('none', 'surcharge', 'discount')",
            name="adjustment_type_values",
        ),
        CheckConstraint("adjustment_amount >= 0", name="adjustment_amount_non_negative"),
        CheckConstraint(
            "payment_status IN ('unpaid', 'partial', 'paid', 'refunded')",
            name="payment_status_values",
        ),
        CheckConstraint(
            "order_status IN ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'cancelled')",
            name="order_status_values",
        ),
        Index("ix_orders_customer_dates", "customer_id", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    seed_source: Mapped[str | None] = mapped_column(String(64), index=True)
    write_revision_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, index=True)
    idempotency_payload_hash: Mapped[str | None] = mapped_column(String(64))
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    contact_name: Mapped[str] = mapped_column(
        String(100), nullable=False, default="", server_default="", index=True
    )
    contact_wechat_name: Mapped[str | None] = mapped_column(String(100))
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    contact_community: Mapped[str | None] = mapped_column(String(200))
    contact_address: Mapped[str | None] = mapped_column(Text)
    contact_building: Mapped[str | None] = mapped_column(String(50))
    contact_unit: Mapped[str | None] = mapped_column(String(50))
    contact_room: Mapped[str | None] = mapped_column(String(50))
    contact_access_method: Mapped[str | None] = mapped_column(String(100))
    contact_access_info: Mapped[str | None] = mapped_column(Text)
    contact_key_status: Mapped[str | None] = mapped_column(String(50))
    contact_key_code: Mapped[str | None] = mapped_column(String(100))
    contact_notes: Mapped[str | None] = mapped_column(Text)
    contact_is_repeat_customer: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    route_latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    route_longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    route_geocode_status: Mapped[str | None] = mapped_column(String(32), index=True)
    route_geocode_fingerprint: Mapped[str | None] = mapped_column(String(64))
    route_geocode_adcode: Mapped[str | None] = mapped_column(String(20))
    route_geocode_level: Mapped[str | None] = mapped_column(String(32))
    cat_snapshot: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    visits_per_day: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")
    cat_count: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")
    service_items: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    pricing_mode: Mapped[str] = mapped_column(
        String(24), nullable=False, default="legacy_components", server_default="legacy_components"
    )
    settlement_mode: Mapped[OrderSettlementMode] = mapped_column(
        portable_enum(OrderSettlementMode, name="order_settlement_mode", length=16),
        nullable=False,
        default=OrderSettlementMode.DAILY,
        server_default=OrderSettlementMode.ORDER_TOTAL.value,
        index=True,
    )
    adjustment_type: Mapped[OrderAdjustmentType] = mapped_column(
        portable_enum(OrderAdjustmentType, name="order_adjustment_type", length=16),
        nullable=False,
        default=OrderAdjustmentType.NONE,
        server_default=OrderAdjustmentType.NONE.value,
    )
    adjustment_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    adjustment_reason: Mapped[str | None] = mapped_column(Text)
    adjustment_service_date: Mapped[date | None] = mapped_column(Date)
    base_price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    extra_cat_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    stairs_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    other_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    paid_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    payment_status: Mapped[OrderPaymentStatus] = mapped_column(
        portable_enum(OrderPaymentStatus, name="order_payment_status", length=16),
        nullable=False,
        default=OrderPaymentStatus.UNPAID,
        server_default=OrderPaymentStatus.UNPAID.value,
        index=True,
    )
    order_status: Mapped[OrderStatus] = mapped_column(
        portable_enum(OrderStatus, name="order_status", length=24),
        nullable=False,
        default=OrderStatus.PENDING_CONFIRMATION,
        server_default=OrderStatus.PENDING_CONFIRMATION.value,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    customer: Mapped["Customer | None"] = relationship(back_populates="orders")
    cat_links: Mapped[list["OrderCat"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    service_dates: Mapped[list["OrderServiceDate"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="OrderServiceDate.service_date",
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order",
        passive_deletes=True,
    )


class OrderCat(Base):
    __tablename__ = "order_cats"

    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cat_id: Mapped[int] = mapped_column(
        ForeignKey("cats.id", ondelete="CASCADE"),
        primary_key=True,
    )

    order: Mapped[Order] = relationship(back_populates="cat_links")
    cat: Mapped["Cat"] = relationship(back_populates="order_links")


class OrderServiceDate(Base):
    __tablename__ = "order_service_dates"
    __table_args__ = (
        CheckConstraint("visit_count > 0 AND visit_count <= 10", name="visit_count_range"),
        Index("ix_order_service_dates_date", "service_date"),
    )

    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        primary_key=True,
    )
    service_date: Mapped[date] = mapped_column(Date, primary_key=True)
    visit_count: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")

    order: Mapped[Order] = relationship(back_populates="service_dates")
