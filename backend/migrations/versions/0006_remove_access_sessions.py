"""Remove password-login sessions from the local-only application.

Revision ID: 0006_remove_access_sessions
Revises: 0005_security_permissions
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006_remove_access_sessions"
down_revision: str | None = "0005_security_permissions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_access_sessions_expires_at", table_name="access_sessions")
    op.drop_index("ix_access_sessions_token_hash", table_name="access_sessions")
    op.drop_table("access_sessions")


def downgrade() -> None:
    op.create_table(
        "access_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("credential_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("role IN ('admin', 'mobile')", name="role_values"),
    )
    op.create_index(
        "ix_access_sessions_token_hash", "access_sessions", ["token_hash"], unique=True
    )
    op.create_index(
        "ix_access_sessions_expires_at", "access_sessions", ["expires_at"]
    )
