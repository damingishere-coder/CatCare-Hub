"""Add permanent sequential business numbers for orders.

Revision ID: 0017_order_business_number
Revises: 0016_payment_soft_delete
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0017_order_business_number"
down_revision: str | None = "0016_payment_soft_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"))


def upgrade() -> None:
    op.create_table(
        "order_number_reservations",
        sa.Column("number", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("number"),
        sqlite_autoincrement=True,
    )
    op.add_column("orders", sa.Column("order_number", sa.Integer(), nullable=True))

    connection = op.get_bind()
    migration_metadata = sa.MetaData()
    reservations = sa.Table(
        "order_number_reservations",
        migration_metadata,
        sa.Column("number", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("issued_at", sa.DateTime(timezone=True)),
    )
    orders = sa.table(
        "orders",
        sa.column("id", sa.Integer()),
        sa.column("order_number", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    order_ids = connection.scalars(
        sa.select(orders.c.id).order_by(orders.c.created_at, orders.c.id)
    ).all()
    for order_id in order_ids:
        result = connection.execute(sa.insert(reservations).values())
        order_number = result.inserted_primary_key[0]
        if order_number is None:
            raise RuntimeError("旧订单编号补发失败")
        connection.execute(
            sa.update(orders)
            .where(orders.c.id == order_id)
            .values(order_number=int(order_number))
        )

    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("orders") as batch_op:
        batch_op.alter_column(
            "order_number",
            existing_type=sa.Integer(),
            nullable=False,
        )
        batch_op.create_unique_constraint(
            "uq_orders_order_number",
            ["order_number"],
        )
        batch_op.create_foreign_key(
            "fk_orders_order_number_order_number_reservations",
            "order_number_reservations",
            ["order_number"],
            ["number"],
            ondelete="RESTRICT",
        )
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_constraint(
            "fk_orders_order_number_order_number_reservations",
            type_="foreignkey",
        )
        batch_op.drop_constraint("uq_orders_order_number", type_="unique")
        batch_op.drop_column("order_number")
    _set_sqlite_foreign_keys(enabled=True)
    op.drop_table("order_number_reservations")
