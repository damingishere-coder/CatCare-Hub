"""Track when task photos were sent to the customer.

Revision ID: 0003_task_photo_delivery
Revises: 0002_task_execution_details
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0003_task_photo_delivery"
down_revision: str | None = "0002_task_execution_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(sa.Column("photos_sent_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("photos_sent_at")
