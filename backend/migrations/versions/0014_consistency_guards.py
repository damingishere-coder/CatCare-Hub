"""Add order, task, and demo-data consistency guards.

Revision ID: 0014_consistency_guards
Revises: 0013_intake_audit_events
"""

from collections.abc import Sequence
from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision: str = "0014_consistency_guards"
down_revision: str | None = "0013_intake_audit_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEMO_SYSTEM_KEY = "catcare-demo-seed-v1"


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"))


def _backfill_exact_demo_records() -> None:
    """Mark only the unique built-in fixture; ambiguous or mixed rows stay unmarked."""

    connection = op.get_bind()
    customers = sa.table(
        "customers",
        sa.column("id", sa.Integer()),
        sa.column("system_key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("wechat_name", sa.String()),
        sa.column("community", sa.String()),
        sa.column("address", sa.Text()),
        sa.column("seed_source", sa.String()),
    )
    cats = sa.table(
        "cats",
        sa.column("id", sa.Integer()),
        sa.column("customer_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("breed", sa.String()),
        sa.column("personality", sa.Text()),
        sa.column("seed_source", sa.String()),
    )
    orders = sa.table(
        "orders",
        sa.column("id", sa.Integer()),
        sa.column("customer_id", sa.Integer()),
        sa.column("contact_name", sa.String()),
        sa.column("cat_count", sa.Integer()),
        sa.column("total_amount", sa.Numeric()),
        sa.column("notes", sa.Text()),
        sa.column("cat_snapshot", sa.JSON()),
        sa.column("seed_source", sa.String()),
    )
    tasks = sa.table(
        "tasks",
        sa.column("id", sa.Integer()),
        sa.column("order_id", sa.Integer()),
        sa.column("customer_id", sa.Integer()),
        sa.column("notes", sa.Text()),
        sa.column("seed_source", sa.String()),
    )
    task_items = sa.table(
        "task_items",
        sa.column("id", sa.Integer()),
        sa.column("task_id", sa.Integer()),
        sa.column("item_type", sa.String()),
        sa.column("required", sa.Boolean()),
        sa.column("completed", sa.Boolean()),
        sa.column("seed_source", sa.String()),
    )
    task_photos = sa.table(
        "task_photos",
        sa.column("id", sa.Integer()),
        sa.column("task_id", sa.Integer()),
        sa.column("seed_source", sa.String()),
    )
    payments = sa.table(
        "payments",
        sa.column("id", sa.Integer()),
        sa.column("order_id", sa.Integer()),
        sa.column("customer_id", sa.Integer()),
        sa.column("amount", sa.Numeric()),
        sa.column("notes", sa.Text()),
        sa.column("seed_source", sa.String()),
    )

    customer_rows = connection.execute(
        sa.select(customers.c.id).where(
            customers.c.system_key == DEMO_SYSTEM_KEY,
            customers.c.name == "演示客户（虚构）",
            customers.c.wechat_name == "演示账号（虚构）",
            customers.c.community == "虚构演示小区",
            customers.c.address == "仅用于开发演示，不对应任何真实地址",
        )
    ).all()
    if len(customer_rows) != 1:
        return
    customer_id = customer_rows[0].id

    cat_rows = connection.execute(
        sa.select(cats.c.id, cats.c.name).where(
            cats.c.customer_id == customer_id,
            cats.c.name.in_(["演示猫咪一号", "演示猫咪二号"]),
            cats.c.breed == "虚构品种",
            cats.c.personality == "开发测试用虚构档案",
        )
    ).all()
    cat_ids = {row.name: row.id for row in cat_rows}
    if len(cat_rows) != 2 or set(cat_ids) != {"演示猫咪一号", "演示猫咪二号"}:
        return

    order_rows = connection.execute(
        sa.select(orders.c.id).where(
            orders.c.customer_id == customer_id,
            orders.c.contact_name == "演示客户（虚构）",
            orders.c.cat_count == 2,
            orders.c.total_amount == Decimal("105.00"),
            orders.c.notes == "仅用于开发测试的虚构订单",
        )
    ).all()
    if len(order_rows) != 1:
        return
    order_id = order_rows[0].id

    task_rows = connection.execute(
        sa.select(tasks.c.id).where(
            tasks.c.order_id == order_id,
            tasks.c.customer_id == customer_id,
            tasks.c.notes == "虚构演示任务",
        )
    ).all()
    task_ids = [row.id for row in task_rows]
    item_rows = connection.execute(
        sa.select(
            task_items.c.id,
            task_items.c.task_id,
            task_items.c.item_type,
            task_items.c.required,
            task_items.c.completed,
        ).where(task_items.c.task_id.in_(task_ids))
    ).all()
    photo_rows = connection.execute(
        sa.select(task_photos.c.id).where(task_photos.c.task_id.in_(task_ids))
    ).all()
    payment_rows = connection.execute(
        sa.select(payments.c.id).where(
            payments.c.order_id == order_id,
            payments.c.customer_id == customer_id,
            payments.c.amount == Decimal("105.00"),
            payments.c.notes == "虚构演示收款",
        )
    ).all()
    expected_items = {"feed", "water", "litter", "photo"}
    exact_items = all(
        len([row for row in item_rows if row.task_id == task_id]) == 4
        and {
            row.item_type for row in item_rows if row.task_id == task_id
        } == expected_items
        and all(
            row.required and not row.completed
            for row in item_rows
            if row.task_id == task_id
        )
        for task_id in task_ids
    )
    if (
        len(task_rows) != 3
        or len(payment_rows) != 1
        or not exact_items
        or photo_rows
    ):
        return

    connection.execute(
        customers.update()
        .where(customers.c.id == customer_id)
        .values(seed_source=DEMO_SYSTEM_KEY)
    )
    connection.execute(
        cats.update()
        .where(cats.c.id.in_(list(cat_ids.values())))
        .values(seed_source=DEMO_SYSTEM_KEY)
    )
    connection.execute(
        orders.update()
        .where(orders.c.id == order_id)
        .values(
            seed_source=DEMO_SYSTEM_KEY,
            cat_snapshot=[
                {"source_cat_id": cat_ids["演示猫咪一号"], "name": "演示猫咪一号"},
                {"source_cat_id": cat_ids["演示猫咪二号"], "name": "演示猫咪二号"},
            ],
        )
    )
    connection.execute(
        tasks.update()
        .where(tasks.c.id.in_([row.id for row in task_rows]))
        .values(seed_source=DEMO_SYSTEM_KEY)
    )
    connection.execute(
        task_items.update()
        .where(task_items.c.id.in_([row.id for row in item_rows]))
        .values(seed_source=DEMO_SYSTEM_KEY)
    )
    connection.execute(
        payments.update()
        .where(payments.c.id == payment_rows[0].id)
        .values(seed_source=DEMO_SYSTEM_KEY)
    )


def upgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.create_index("ix_customers_seed_source", ["seed_source"])

    with op.batch_alter_table("cats") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.create_index("ix_cats_seed_source", ["seed_source"])

    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.add_column(
            sa.Column(
                "write_revision_number",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(sa.Column("idempotency_key", sa.String(length=128)))
        batch_op.add_column(sa.Column("idempotency_payload_hash", sa.String(length=64)))
        batch_op.create_index("ix_orders_seed_source", ["seed_source"])
        batch_op.create_index(
            "ix_orders_idempotency_key", ["idempotency_key"], unique=True
        )

    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.add_column(
            sa.Column(
                "execution_revision_number",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.create_index("ix_tasks_seed_source", ["seed_source"])

    with op.batch_alter_table("task_items") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.create_index("ix_task_items_seed_source", ["seed_source"])

    with op.batch_alter_table("task_photos") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.create_index("ix_task_photos_seed_source", ["seed_source"])

    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("seed_source", sa.String(length=64)))
        batch_op.create_index("ix_payments_seed_source", ["seed_source"])
    _set_sqlite_foreign_keys(enabled=True)
    _backfill_exact_demo_records()


def downgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_index("ix_payments_seed_source")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_index("ix_tasks_seed_source")
        batch_op.drop_column("execution_revision_number")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("task_photos") as batch_op:
        batch_op.drop_index("ix_task_photos_seed_source")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("task_items") as batch_op:
        batch_op.drop_index("ix_task_items_seed_source")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_index("ix_orders_idempotency_key")
        batch_op.drop_index("ix_orders_seed_source")
        batch_op.drop_column("idempotency_payload_hash")
        batch_op.drop_column("idempotency_key")
        batch_op.drop_column("write_revision_number")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("cats") as batch_op:
        batch_op.drop_index("ix_cats_seed_source")
        batch_op.drop_column("seed_source")

    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_index("ix_customers_seed_source")
        batch_op.drop_column("seed_source")
    _set_sqlite_foreign_keys(enabled=True)
