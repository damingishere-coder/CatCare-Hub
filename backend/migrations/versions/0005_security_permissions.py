"""Add access sessions and hash customer intake tokens.

Revision ID: 0005_security_permissions
Revises: 0004_customer_intake_conversion
"""

from collections.abc import Sequence
import hashlib

from alembic import op
import sqlalchemy as sa


revision: str = "0005_security_permissions"
down_revision: str | None = "0004_customer_intake_conversion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "access_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("credential_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role IN ('admin', 'mobile')", name="role_values"),
    )
    op.create_index(
        "ix_access_sessions_token_hash", "access_sessions", ["token_hash"], unique=True
    )
    op.create_index(
        "ix_access_sessions_expires_at", "access_sessions", ["expires_at"]
    )

    op.add_column(
        "customer_form_tokens", sa.Column("token_hash", sa.String(length=64), nullable=True)
    )
    connection = op.get_bind()
    token_table = sa.table(
        "customer_form_tokens",
        sa.column("id", sa.Integer()),
        sa.column("token", sa.String()),
        sa.column("token_hash", sa.String()),
    )
    for token_id, raw_token in connection.execute(
        sa.select(token_table.c.id, token_table.c.token)
    ):
        connection.execute(
            token_table.update()
            .where(token_table.c.id == token_id)
            .values(token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest())
        )
    op.drop_index("ix_customer_form_tokens_token", table_name="customer_form_tokens")
    with op.batch_alter_table("customer_form_tokens") as batch_op:
        batch_op.alter_column("token_hash", nullable=False)
        batch_op.drop_column("token")
    op.create_index(
        "ix_customer_form_tokens_token_hash",
        "customer_form_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.add_column(
        "customer_form_tokens", sa.Column("token", sa.String(length=128), nullable=True)
    )
    connection = op.get_bind()
    token_table = sa.table(
        "customer_form_tokens",
        sa.column("id", sa.Integer()),
        sa.column("token", sa.String()),
        sa.column("token_hash", sa.String()),
    )
    connection.execute(
        token_table.update().values(token="unrecoverable_" + token_table.c.token_hash)
    )
    op.drop_index("ix_customer_form_tokens_token_hash", table_name="customer_form_tokens")
    with op.batch_alter_table("customer_form_tokens") as batch_op:
        batch_op.alter_column("token", nullable=False)
        batch_op.drop_column("token_hash")
    op.create_index(
        "ix_customer_form_tokens_token",
        "customer_form_tokens",
        ["token"],
        unique=True,
    )

    op.drop_index("ix_access_sessions_expires_at", table_name="access_sessions")
    op.drop_index("ix_access_sessions_token_hash", table_name="access_sessions")
    op.drop_table("access_sessions")
