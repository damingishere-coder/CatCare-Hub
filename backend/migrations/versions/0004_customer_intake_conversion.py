"""Make customer intake single-use and track conversion results.

Revision ID: 0004_customer_intake_conversion
Revises: 0003_task_photo_delivery
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004_customer_intake_conversion"
down_revision: str | None = "0003_task_photo_delivery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.add_column(sa.Column("reviewed_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("converted_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("converted_customer_id", sa.Integer()))
        batch_op.add_column(sa.Column("converted_order_id", sa.Integer()))
        batch_op.create_unique_constraint(
            "uq_customer_form_submissions_token_id",
            ["token_id"],
        )
        batch_op.create_foreign_key(
            "fk_customer_form_submissions_converted_customer_id_customers",
            "customers",
            ["converted_customer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_customer_form_submissions_converted_order_id_orders",
            "orders",
            ["converted_order_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.drop_constraint(
            "fk_customer_form_submissions_converted_order_id_orders",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_customer_form_submissions_converted_customer_id_customers",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "uq_customer_form_submissions_token_id",
            type_="unique",
        )
        batch_op.drop_column("converted_order_id")
        batch_op.drop_column("converted_customer_id")
        batch_op.drop_column("converted_at")
        batch_op.drop_column("reviewed_at")
