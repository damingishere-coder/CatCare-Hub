from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import (
    FormSubmissionStatus,
    FormTokenStatus,
    portable_enum,
)
from app.models.mixins import TimestampMixin


class CustomerFormToken(TimestampMixin, Base):
    __tablename__ = "customer_form_tokens"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'disabled', 'expired')",
            name="status_values",
        ),
        Index("ix_customer_form_tokens_status_expires", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    status: Mapped[FormTokenStatus] = mapped_column(
        portable_enum(FormTokenStatus, name="form_token_status", length=16),
        nullable=False,
        default=FormTokenStatus.ACTIVE,
        server_default=FormTokenStatus.ACTIVE.value,
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    submissions: Mapped[list["CustomerFormSubmission"]] = relationship(
        back_populates="token",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CustomerFormSubmission(TimestampMixin, Base):
    __tablename__ = "customer_form_submissions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'submitted', 'reviewed', 'converted', 'expired')",
            name="status_values",
        ),
        UniqueConstraint("token_id", name="uq_customer_form_submissions_token_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[int] = mapped_column(
        ForeignKey("customer_form_tokens.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    review_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    review_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    status: Mapped[FormSubmissionStatus] = mapped_column(
        portable_enum(FormSubmissionStatus, name="form_submission_status", length=16),
        nullable=False,
        default=FormSubmissionStatus.DRAFT,
        server_default=FormSubmissionStatus.DRAFT.value,
        index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    converted_customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL")
    )
    converted_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL")
    )

    token: Mapped[CustomerFormToken] = relationship(back_populates="submissions")
