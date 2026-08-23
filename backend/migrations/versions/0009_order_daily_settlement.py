"""Add daily settlement, dated adjustments, payment allocation and system flags.

Revision ID: 0009_order_daily_settlement
Revises: 0008_order_snapshots_and_review
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0009_order_daily_settlement"
down_revision: str | None = "0008_order_snapshots_and_review"
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
    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(
            sa.Column(
                "settlement_mode",
                sa.String(length=16),
                nullable=False,
                server_default="order_total",
            )
        )
        batch_op.add_column(
            sa.Column(
                "adjustment_type",
                sa.String(length=16),
                nullable=False,
                server_default="none",
            )
        )
        batch_op.add_column(
            sa.Column(
                "adjustment_amount",
                sa.Numeric(10, 2),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(sa.Column("adjustment_reason", sa.Text()))
        batch_op.add_column(sa.Column("adjustment_service_date", sa.Date()))
        batch_op.create_check_constraint(
            "settlement_mode_values",
            "settlement_mode IN ('daily', 'order_total')",
        )
        batch_op.create_check_constraint(
            "adjustment_type_values",
            "adjustment_type IN ('none', 'surcharge', 'discount')",
        )
        batch_op.create_check_constraint(
            "adjustment_amount_non_negative", "adjustment_amount >= 0"
        )
    op.create_index(
        "ix_orders_settlement_mode", "orders", ["settlement_mode"], unique=False
    )

    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("service_date", sa.Date()))
    op.create_index(
        "ix_payments_service_date", "payments", ["service_date"], unique=False
    )
    op.create_index(
        "ix_payments_order_service_date",
        "payments",
        ["order_id", "service_date"],
        unique=False,
    )

    op.create_table(
        "system_flags",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.JSON()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("key"),
    )
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    op.drop_table("system_flags")
    op.drop_index("ix_payments_order_service_date", table_name="payments")
    op.drop_index("ix_payments_service_date", table_name="payments")
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_column("service_date")

    op.drop_index("ix_orders_settlement_mode", table_name="orders")
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_constraint("adjustment_amount_non_negative", type_="check")
        batch_op.drop_constraint("adjustment_type_values", type_="check")
        batch_op.drop_constraint("settlement_mode_values", type_="check")
        batch_op.drop_column("adjustment_service_date")
        batch_op.drop_column("adjustment_reason")
        batch_op.drop_column("adjustment_amount")
        batch_op.drop_column("adjustment_type")
        batch_op.drop_column("settlement_mode")
    _set_sqlite_foreign_keys(enabled=True)
