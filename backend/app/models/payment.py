from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String, Text, func
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
        CheckConstraint(
            "(deleted_at IS NULL AND deleted_reason IS NULL) OR "
            "(deleted_at IS NOT NULL AND deleted_reason IS NOT NULL "
            "AND length(trim(deleted_reason)) BETWEEN 1 AND 500)",
            name="payment_delete_audit",
        ),
        Index("ix_payments_customer_paid_at", "customer_id", "paid_at"),
        Index("ix_payments_order_service_date", "order_id", "service_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    seed_source: Mapped[str | None] = mapped_column(String(64), index=True)
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
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    deleted_reason: Mapped[str | None] = mapped_column(Text)

    order: Mapped["Order"] = relationship(back_populates="payments")
    customer: Mapped["Customer | None"] = relationship(back_populates="payments")
    audit_events: Mapped[list["PaymentRecordAuditEvent"]] = relationship(
        back_populates="payment",
        order_by="PaymentRecordAuditEvent.created_at",
    )


class PaymentRecordAuditEvent(Base):
    __tablename__ = "payment_record_audit_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('deleted', 'restored')",
            name="payment_record_audit_action_values",
        ),
        CheckConstraint(
            "(action = 'deleted' AND reason IS NOT NULL "
            "AND length(trim(reason)) BETWEEN 1 AND 500) OR "
            "(action = 'restored' AND reason IS NULL)",
            name="payment_record_audit_reason",
        ),
        Index(
            "ix_payment_record_audit_events_payment_created",
            "payment_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_id: Mapped[int] = mapped_column(
        ForeignKey("payments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    payment: Mapped[Payment] = relationship(back_populates="audit_events")
