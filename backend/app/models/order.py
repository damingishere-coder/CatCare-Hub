from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, JSON, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import OrderPaymentStatus, OrderStatus, portable_enum
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
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    visits_per_day: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")
    service_items: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
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

    customer: Mapped["Customer"] = relationship(back_populates="orders")
    cat_links: Mapped[list["OrderCat"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
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
