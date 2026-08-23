from datetime import datetime

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SystemFlag(Base):
    """Durable local marker for one-time, system-owned operations."""

    __tablename__ = "system_flags"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    payload: Mapped[dict[str, object] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
