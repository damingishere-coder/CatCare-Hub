"""Add auditable soft voids for mistaken payment records.

Revision ID: 0010_payment_void_audit
Revises: 0009_order_daily_settlement
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0010_payment_void_audit"
down_revision: str | None = "0009_order_daily_settlement"
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
        batch_op.drop_constraint("payment_status_values", type_="check")
        batch_op.add_column(sa.Column("voided_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("voided_reason", sa.Text()))
        batch_op.create_check_constraint(
            "payment_status_values",
            "payment_status IN ('pending', 'completed', 'refunded', 'voided')",
        )
        batch_op.create_check_constraint(
            "payment_void_audit",
            "(payment_status = 'voided' AND voided_at IS NOT NULL "
            "AND voided_reason IS NOT NULL AND length(trim(voided_reason)) BETWEEN 1 AND 500) "
            "OR (payment_status != 'voided' AND voided_at IS NULL AND voided_reason IS NULL)",
        )
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    connection = op.get_bind()
    voided_count = connection.scalar(
        sa.text("SELECT count(*) FROM payments WHERE payment_status = 'voided'")
    )
    if voided_count:
        raise RuntimeError("存在已撤销收款流水，无法无损降级到 0009")

    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("payment_void_audit", type_="check")
        batch_op.drop_constraint("payment_status_values", type_="check")
        batch_op.create_check_constraint(
            "payment_status_values",
            "payment_status IN ('pending', 'completed', 'refunded')",
        )
        batch_op.drop_column("voided_reason")
        batch_op.drop_column("voided_at")
    _set_sqlite_foreign_keys(enabled=True)
