from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class AccessSession(TimestampMixin, Base):
    __tablename__ = "access_sessions"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'mobile')", name="role_values"),
        Index("ix_access_sessions_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    credential_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
