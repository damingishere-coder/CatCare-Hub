from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import PaymentMethod, PaymentRecordStatus, portable_enum
from app.models.mixins import TimestampMixin


if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.order import Order


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "payment_method IN ('wechat', 'alipay', 'cash', 'other')",
            name="payment_method_values",
        ),
        CheckConstraint(
            "payment_status IN ('pending', 'completed', 'refunded', 'voided')",
            name="payment_status_values",
        ),
        CheckConstraint(
            "(payment_status = 'voided' AND voided_at IS NOT NULL "
            "AND voided_reason IS NOT NULL AND length(trim(voided_reason)) BETWEEN 1 AND 500) "
            "OR (payment_status != 'voided' AND voided_at IS NULL AND voided_reason IS NULL)",
            name="payment_void_audit",
        ),
        Index("ix_payments_customer_paid_at", "customer_id", "paid_at"),
        Index("ix_payments_order_service_date", "order_id", "service_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    service_date: Mapped[date | None] = mapped_column(Date, index=True)
    payment_method: Mapped[PaymentMethod] = mapped_column(
        portable_enum(PaymentMethod, name="payment_method", length=16),
        nullable=False,
    )
    payment_status: Mapped[PaymentRecordStatus] = mapped_column(
        portable_enum(PaymentRecordStatus, name="payment_record_status", length=16),
        nullable=False,
        default=PaymentRecordStatus.COMPLETED,
        server_default=PaymentRecordStatus.COMPLETED.value,
        index=True,
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_reason: Mapped[str | None] = mapped_column(Text)

    order: Mapped["Order"] = relationship(back_populates="payments")
    customer: Mapped["Customer | None"] = relationship(back_populates="payments")
