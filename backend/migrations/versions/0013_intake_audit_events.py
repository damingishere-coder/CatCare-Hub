"""Add non-sensitive customer intake audit events.

Revision ID: 0013_intake_audit_events
Revises: 0012_wechat_customer_intake
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0013_intake_audit_events"
down_revision: str | None = "0012_wechat_customer_intake"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "intake_audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "token_id",
            sa.Integer(),
            sa.ForeignKey("customer_form_tokens.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "submission_id",
            sa.Integer(),
            sa.ForeignKey("customer_form_submissions.id", ondelete="CASCADE"),
        ),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("actor", sa.String(length=16), nullable=False),
        sa.Column("revision_number", sa.Integer()),
        sa.Column("decision_mode", sa.String(length=16)),
        sa.Column(
            "details",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "token_id IS NOT NULL OR submission_id IS NOT NULL",
            name="target_required",
        ),
    )
    op.create_index(
        "ix_intake_audit_events_token_id",
        "intake_audit_events",
        ["token_id"],
    )
    op.create_index(
        "ix_intake_audit_events_submission_id",
        "intake_audit_events",
        ["submission_id"],
    )
    op.create_index(
        "ix_intake_audit_events_event_type",
        "intake_audit_events",
        ["event_type"],
    )
    op.create_index(
        "ix_intake_audit_events_submission_created",
        "intake_audit_events",
        ["submission_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_intake_audit_events_submission_created",
        table_name="intake_audit_events",
    )
    op.drop_index(
        "ix_intake_audit_events_event_type",
        table_name="intake_audit_events",
    )
    op.drop_index(
        "ix_intake_audit_events_submission_id",
        table_name="intake_audit_events",
    )
    op.drop_index(
        "ix_intake_audit_events_token_id",
        table_name="intake_audit_events",
    )
    op.drop_table("intake_audit_events")
