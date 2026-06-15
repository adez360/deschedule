"""users.daily_hour_max — per-employee daily scheduling cap

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-11

NULL means "use the system default" (8h, scheduler.DAILY_HOUR_MAX).
"""
import sqlalchemy as sa
from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("daily_hour_max", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "daily_hour_max")
