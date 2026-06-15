"""stores.cross_group — IDEA-10 G1 cross-store scheduling group

Stores sharing the same non-null label can cross-schedule each other's
employees; NULL means the store does not participate in cross-store
scheduling.

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-06-12
"""
import sqlalchemy as sa
from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("cross_group", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("stores", "cross_group")
