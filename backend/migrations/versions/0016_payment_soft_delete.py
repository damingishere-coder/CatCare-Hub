"""Add auditable soft deletion and visibility restore for payment records.

Revision ID: 0016_payment_soft_delete
Revises: 0015_customer_access_split
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0016_payment_soft_delete"
down_revision: str | None = "0015_customer_access_split"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"))


def upgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("deleted_reason", sa.Text()))
        batch_op.create_index("ix_payments_deleted_at", ["deleted_at"])
        batch_op.create_check_constraint(
            "payment_delete_audit",
            "(deleted_at IS NULL AND deleted_reason IS NULL) OR "
            "(deleted_at IS NOT NULL AND deleted_reason IS NOT NULL "
            "AND length(trim(deleted_reason)) BETWEEN 1 AND 500)",
        )

    op.create_table(
        "payment_record_audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "payment_id",
            sa.Integer(),
            sa.ForeignKey("payments.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "action IN ('deleted', 'restored')",
            name="payment_record_audit_action_values",
        ),
        sa.CheckConstraint(
            "(action = 'deleted' AND reason IS NOT NULL "
            "AND length(trim(reason)) BETWEEN 1 AND 500) OR "
            "(action = 'restored' AND reason IS NULL)",
            name="payment_record_audit_reason",
        ),
    )
    op.create_index(
        "ix_payment_record_audit_events_payment_created",
        "payment_record_audit_events",
        ["payment_id", "created_at"],
    )
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    connection = op.get_bind()
    event_count = connection.scalar(
        sa.text("SELECT count(*) FROM payment_record_audit_events")
    )
    deleted_count = connection.scalar(
        sa.text("SELECT count(*) FROM payments WHERE deleted_at IS NOT NULL")
    )
    if event_count or deleted_count:
        raise RuntimeError("存在收款删除或恢复审计记录，无法无损降级到 0015")

    _set_sqlite_foreign_keys(enabled=False)
    op.drop_index(
        "ix_payment_record_audit_events_payment_created",
        table_name="payment_record_audit_events",
    )
    op.drop_table("payment_record_audit_events")
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("payment_delete_audit", type_="check")
        batch_op.drop_index("ix_payments_deleted_at")
        batch_op.drop_column("deleted_reason")
        batch_op.drop_column("deleted_at")
    _set_sqlite_foreign_keys(enabled=True)
