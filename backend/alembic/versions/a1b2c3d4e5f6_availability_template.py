"""availability_templates table + availabilities.auto_filled — IDEA-11 G2

Standing weekly availability moves out of the is_default_template flag on
availabilities into its own one-per-user table. availabilities gains an
auto_filled flag marking rows materialized from the template by the weekly job.

Revision ID: a1b2c3d4e5f6
Revises: f7a8b9c0d1e2
Create Date: 2026-06-15
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "a1b2c3d4e5f6"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "availability_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("slots", JSONB, nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", name="uq_availability_template_user"),
    )
    op.create_index(
        "ix_availability_templates_user_id", "availability_templates", ["user_id"]
    )

    # Migrate existing default-template rows into the new table before dropping the flag.
    op.execute(
        """
        INSERT INTO availability_templates (id, user_id, slots, updated_at)
        SELECT gen_random_uuid(), user_id, slots, now()
        FROM availabilities
        WHERE is_default_template = true
        ON CONFLICT (user_id) DO NOTHING
        """
    )

    op.add_column(
        "availabilities",
        sa.Column(
            "auto_filled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.drop_column("availabilities", "is_default_template")


def downgrade() -> None:
    op.add_column(
        "availabilities",
        sa.Column(
            "is_default_template",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.drop_column("availabilities", "auto_filled")
    op.drop_index("ix_availability_templates_user_id", table_name="availability_templates")
    op.drop_table("availability_templates")
