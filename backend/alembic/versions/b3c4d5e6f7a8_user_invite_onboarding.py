"""user invite / onboarding token + nullable password — IDEA-12

Employees are no longer given a password by the manager. Account creation now
issues a one-time invite token (with expiry); the employee sets their own
password via the public /onboard flow. hashed_password becomes nullable to
represent the invited-but-not-yet-onboarded state. The same token mechanism
doubles as a simple password-reset (resend invite).

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-06-15
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "b3c4d5e6f7a8"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("invite_token", UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "users", sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_users_invite_token", "users", ["invite_token"], unique=True
    )
    op.alter_column("users", "hashed_password", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    # Backfill any null passwords so the NOT NULL constraint can be restored.
    op.execute("UPDATE users SET hashed_password = '' WHERE hashed_password IS NULL")
    op.alter_column("users", "hashed_password", existing_type=sa.String(255), nullable=False)
    op.drop_index("ix_users_invite_token", table_name="users")
    op.drop_column("users", "invite_expires_at")
    op.drop_column("users", "invite_token")
