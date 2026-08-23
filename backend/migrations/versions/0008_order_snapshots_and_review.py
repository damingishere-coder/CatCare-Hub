"""Make orders operationally independent from customer profiles.

Revision ID: 0008_order_snapshots_and_review
Revises: 0007_simplify_customer_orders
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0008_order_snapshots_and_review"
down_revision: str | None = "0007_simplify_customer_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
}


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    """Keep dependent history while SQLite batch mode rebuilds parent tables."""

    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    value = "ON" if enabled else "OFF"
    # SQLite ignores PRAGMA foreign_keys changes inside a transaction. Alembic's
    # autocommit block commits the preceding DDL first so the setting really takes
    # effect before batch_alter_table drops its temporary source table.
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={value}"))


def _snapshot_columns() -> list[sa.Column]:
    return [
        sa.Column("contact_name", sa.String(length=100), server_default=""),
        sa.Column("contact_wechat_name", sa.String(length=100)),
        sa.Column("contact_phone", sa.String(length=32)),
        sa.Column("contact_community", sa.String(length=200)),
        sa.Column("contact_address", sa.Text()),
        sa.Column("contact_building", sa.String(length=50)),
        sa.Column("contact_unit", sa.String(length=50)),
        sa.Column("contact_room", sa.String(length=50)),
        sa.Column("contact_access_method", sa.String(length=100)),
        sa.Column("contact_access_info", sa.Text()),
        sa.Column("contact_key_status", sa.String(length=50)),
        sa.Column("contact_key_code", sa.String(length=100)),
        sa.Column("contact_notes", sa.Text()),
        sa.Column(
            "contact_is_repeat_customer",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("route_latitude", sa.Numeric(10, 7)),
        sa.Column("route_longitude", sa.Numeric(10, 7)),
        sa.Column("route_geocode_status", sa.String(length=32)),
        sa.Column("cat_snapshot", sa.JSON(), server_default="[]"),
    ]


def _cat_snapshot(connection: sa.Connection, order_id: int) -> list[dict[str, object]]:
    rows = connection.execute(
        sa.text(
            "SELECT cats.id, cats.name, cats.photo_url, cats.gender, cats.age, "
            "cats.breed, cats.personality, cats.food, cats.food_preference, "
            "cats.litter_type, cats.medication_required, cats.medication_notes, "
            "cats.special_notes, cats.service_notes "
            "FROM cats JOIN order_cats ON order_cats.cat_id = cats.id "
            "WHERE order_cats.order_id = :order_id ORDER BY cats.id"
        ),
        {"order_id": order_id},
    ).mappings()
    return [
        {
            "source_cat_id": row["id"],
            "name": row["name"],
            "photo_url": row["photo_url"],
            "gender": row["gender"],
            "age": str(row["age"]) if row["age"] is not None else None,
            "breed": row["breed"],
            "personality": row["personality"],
            "food": row["food"],
            "food_preference": row["food_preference"],
            "litter_type": row["litter_type"],
            "medication_required": bool(row["medication_required"]),
            "medication_notes": row["medication_notes"],
            "special_notes": row["special_notes"],
            "service_notes": row["service_notes"],
        }
        for row in rows
    ]


def upgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    op.add_column("customers", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.create_index("ix_customers_archived_at", "customers", ["archived_at"])

    for column in _snapshot_columns():
        op.add_column("orders", column)

    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.add_column(sa.Column("review_payload", sa.JSON()))
        batch_op.add_column(sa.Column("review_unit_price", sa.Numeric(10, 2)))

    connection = op.get_bind()
    orders_table = sa.table(
        "orders",
        sa.column("id", sa.Integer()),
        sa.column("contact_name", sa.String()),
        sa.column("contact_wechat_name", sa.String()),
        sa.column("contact_phone", sa.String()),
        sa.column("contact_community", sa.String()),
        sa.column("contact_address", sa.Text()),
        sa.column("contact_building", sa.String()),
        sa.column("contact_unit", sa.String()),
        sa.column("contact_room", sa.String()),
        sa.column("contact_access_method", sa.String()),
        sa.column("contact_access_info", sa.Text()),
        sa.column("contact_key_status", sa.String()),
        sa.column("contact_key_code", sa.String()),
        sa.column("contact_notes", sa.Text()),
        sa.column("contact_is_repeat_customer", sa.Boolean()),
        sa.column("route_latitude", sa.Numeric()),
        sa.column("route_longitude", sa.Numeric()),
        sa.column("route_geocode_status", sa.String()),
        sa.column("cat_snapshot", sa.JSON()),
    )
    rows = connection.execute(
        sa.text(
            "SELECT orders.id AS order_id, customers.* FROM orders "
            "JOIN customers ON customers.id = orders.customer_id"
        )
    ).mappings()
    for row in rows:
        connection.execute(
            sa.update(orders_table)
            .where(orders_table.c.id == row["order_id"])
            .values(
                contact_name=row["name"],
                contact_wechat_name=row["wechat_name"],
                contact_phone=row["phone"],
                contact_community=row["community"],
                contact_address=row["address"],
                contact_building=row["building"],
                contact_unit=row["unit"],
                contact_room=row["room"],
                contact_access_method=row["access_method"],
                contact_access_info=row["access_info"],
                contact_key_status=row["key_status"],
                contact_key_code=row["key_code"],
                contact_notes=row["notes"],
                contact_is_repeat_customer=bool(row["is_repeat_customer"]),
                route_latitude=row["latitude"],
                route_longitude=row["longitude"],
                route_geocode_status=row["geocode_status"],
                cat_snapshot=_cat_snapshot(connection, int(row["order_id"])),
            )
        )

    with op.batch_alter_table(
        "orders", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            "fk_orders_customer_id_customers", type_="foreignkey"
        )
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=True
        )
        batch_op.alter_column(
            "contact_name", existing_type=sa.String(length=100), nullable=False
        )
        batch_op.alter_column(
            "cat_snapshot", existing_type=sa.JSON(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_orders_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table(
        "tasks", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint("fk_tasks_customer_id_customers", type_="foreignkey")
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=True
        )
        batch_op.create_foreign_key(
            "fk_tasks_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table(
        "payments", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            "fk_payments_customer_id_customers", type_="foreignkey"
        )
        batch_op.drop_constraint("fk_payments_order_id_orders", type_="foreignkey")
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=True
        )
        batch_op.create_foreign_key(
            "fk_payments_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_payments_order_id_orders",
            "orders",
            ["order_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    op.create_index("ix_orders_contact_name", "orders", ["contact_name"])
    op.create_index(
        "ix_orders_route_geocode_status", "orders", ["route_geocode_status"]
    )
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    op.drop_index("ix_orders_route_geocode_status", table_name="orders")
    op.drop_index("ix_orders_contact_name", table_name="orders")

    with op.batch_alter_table(
        "payments", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint("fk_payments_order_id_orders", type_="foreignkey")
        batch_op.drop_constraint(
            "fk_payments_customer_id_customers", type_="foreignkey"
        )
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_payments_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_payments_order_id_orders",
            "orders",
            ["order_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table(
        "tasks", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint("fk_tasks_customer_id_customers", type_="foreignkey")
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_tasks_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table(
        "orders", naming_convention=NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint("fk_orders_customer_id_customers", type_="foreignkey")
        batch_op.alter_column(
            "customer_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_orders_customer_id_customers",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.drop_column("review_unit_price")
        batch_op.drop_column("review_payload")

    for column in reversed(_snapshot_columns()):
        op.drop_column("orders", column.name)

    op.drop_index("ix_customers_archived_at", table_name="customers")
    op.drop_column("customers", "archived_at")
    _set_sqlite_foreign_keys(enabled=True)
