"""Add structured task execution details.

Revision ID: 0002_task_execution_details
Revises: 0001_initial_schema
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0002_task_execution_details"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(sa.Column("cat_status", sa.Text()))
        batch_op.add_column(sa.Column("exception_notes", sa.Text()))


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("exception_notes")
        batch_op.drop_column("cat_status")
