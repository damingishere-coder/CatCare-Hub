"""Simplify customer entry and add explicit order schedules.

Revision ID: 0007_simplify_customer_orders
Revises: 0006_remove_access_sessions
"""

from collections.abc import Sequence
from datetime import date, timedelta

from alembic import op
import sqlalchemy as sa


revision: str = "0007_simplify_customer_orders"
down_revision: str | None = "0006_remove_access_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEMO_MARKER = "[catcare-demo-seed-v1]"
DEMO_SYSTEM_KEY = "catcare-demo-seed-v1"


def upgrade() -> None:
    op.add_column("customers", sa.Column("system_key", sa.String(length=64)))
    op.create_index(
        "ix_customers_system_key", "customers", ["system_key"], unique=True
    )

    op.add_column(
        "orders",
        sa.Column("cat_count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "orders",
        sa.Column(
            "pricing_mode",
            sa.String(length=24),
            nullable=False,
            server_default="legacy_components",
        ),
    )
    op.create_table(
        "order_service_dates",
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint(
            "visit_count > 0 AND visit_count <= 10", name="visit_count_range"
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("order_id", "service_date"),
    )
    op.create_index(
        "ix_order_service_dates_date",
        "order_service_dates",
        ["service_date"],
        unique=False,
    )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE customers SET system_key = :system_key, notes = NULL "
            "WHERE notes = :marker"
        ),
        {"system_key": DEMO_SYSTEM_KEY, "marker": DEMO_MARKER},
    )
    connection.execute(
        sa.text(
            "UPDATE orders SET cat_count = CASE "
            "WHEN (SELECT COUNT(*) FROM order_cats WHERE order_cats.order_id = orders.id) > 0 "
            "THEN (SELECT COUNT(*) FROM order_cats WHERE order_cats.order_id = orders.id) "
            "ELSE 1 END"
        )
    )

    orders = connection.execute(
        sa.text("SELECT id, start_date, end_date, visits_per_day FROM orders")
    ).mappings()
    schedule_rows: list[dict[str, object]] = []
    for order in orders:
        start = date.fromisoformat(str(order["start_date"]))
        end = date.fromisoformat(str(order["end_date"]))
        current = start
        while current <= end:
            schedule_rows.append(
                {
                    "order_id": int(order["id"]),
                    "service_date": current,
                    "visit_count": int(order["visits_per_day"]),
                }
            )
            current += timedelta(days=1)
    if schedule_rows:
        connection.execute(
            sa.text(
                "INSERT INTO order_service_dates (order_id, service_date, visit_count) "
                "VALUES (:order_id, :service_date, :visit_count)"
            ),
            schedule_rows,
        )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE customers SET notes = :marker "
            "WHERE system_key = :system_key AND notes IS NULL"
        ),
        {"marker": DEMO_MARKER, "system_key": DEMO_SYSTEM_KEY},
    )
    op.drop_index("ix_order_service_dates_date", table_name="order_service_dates")
    op.drop_table("order_service_dates")
    op.drop_column("orders", "pricing_mode")
    op.drop_column("orders", "cat_count")
    op.drop_index("ix_customers_system_key", table_name="customers")
    op.drop_column("customers", "system_key")
