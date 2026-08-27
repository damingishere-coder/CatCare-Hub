"""Add safe customer intake review and archive receipts.

Revision ID: 0012_wechat_customer_intake
Revises: 0011_route_geocode_provenance
"""

from collections.abc import Sequence
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = "0012_wechat_customer_intake"
down_revision: str | None = "0011_route_geocode_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


NEW_STATUS_CHECK = (
    "status IN ('draft', 'submitted', 'reviewed', 'processing', "
    "'archived_customer', 'archived_order', 'voided', 'redacted', "
    "'converted', 'expired')"
)
OLD_STATUS_CHECK = (
    "status IN ('draft', 'submitted', 'reviewed', 'converted', 'expired')"
)


def upgrade() -> None:
    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.drop_constraint(
            "status_values",
            type_="check",
        )
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=16),
            type_=sa.String(length=24),
            existing_nullable=False,
        )
        batch_op.add_column(sa.Column("submission_uuid", sa.String(length=36)))
        batch_op.add_column(
            sa.Column(
                "revision_number",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(sa.Column("decision_mode", sa.String(length=16)))
        batch_op.add_column(sa.Column("submit_idempotency_key", sa.String(length=128)))
        batch_op.add_column(sa.Column("submit_payload_hash", sa.String(length=64)))
        batch_op.add_column(sa.Column("idempotency_key", sa.String(length=128)))
        batch_op.add_column(sa.Column("claim_token_hash", sa.String(length=64)))
        batch_op.add_column(sa.Column("claim_expires_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("voided_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("purge_after", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("redacted_at", sa.DateTime(timezone=True)))
        batch_op.add_column(sa.Column("receipt_customer_id", sa.Integer()))
        batch_op.add_column(sa.Column("receipt_order_id", sa.Integer()))
        batch_op.create_check_constraint("status_values", NEW_STATUS_CHECK)

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id FROM customer_form_submissions ORDER BY id")
    ).all()
    for (submission_id,) in rows:
        connection.execute(
            sa.text(
                "UPDATE customer_form_submissions "
                "SET submission_uuid = :submission_uuid WHERE id = :submission_id"
            ),
            {
                "submission_uuid": str(uuid4()),
                "submission_id": submission_id,
            },
        )

    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.alter_column("submission_uuid", nullable=False)
        batch_op.create_unique_constraint(
            "uq_customer_form_submissions_submission_uuid",
            ["submission_uuid"],
        )
        batch_op.create_index(
            "ix_customer_form_submissions_status_purge",
            ["status", "purge_after"],
        )

def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE customer_form_submissions SET status = CASE "
            "WHEN status = 'archived_order' THEN 'converted' "
            "WHEN status IN ('processing', 'archived_customer', 'voided', 'redacted') "
            "THEN 'reviewed' ELSE status END"
        )
    )

    with op.batch_alter_table("customer_form_submissions") as batch_op:
        batch_op.drop_index("ix_customer_form_submissions_status_purge")
        batch_op.drop_constraint(
            "uq_customer_form_submissions_submission_uuid",
            type_="unique",
        )
        batch_op.drop_constraint(
            "status_values",
            type_="check",
        )
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=24),
            type_=sa.String(length=16),
            existing_nullable=False,
        )
        batch_op.drop_column("redacted_at")
        batch_op.drop_column("receipt_order_id")
        batch_op.drop_column("receipt_customer_id")
        batch_op.drop_column("purge_after")
        batch_op.drop_column("voided_at")
        batch_op.drop_column("claim_expires_at")
        batch_op.drop_column("claim_token_hash")
        batch_op.drop_column("idempotency_key")
        batch_op.drop_column("submit_payload_hash")
        batch_op.drop_column("submit_idempotency_key")
        batch_op.drop_column("decision_mode")
        batch_op.drop_column("revision_number")
        batch_op.drop_column("submission_uuid")
        batch_op.create_check_constraint("status_values", OLD_STATUS_CHECK)
