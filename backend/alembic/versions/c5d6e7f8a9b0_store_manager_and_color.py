"""stores.manager_user_id + stores.color — 5.3.3 store management

Adds a store manager (FK users, SET NULL on delete) and a representative
colour (hex string, e.g. "#7C3AED") used as the store accent across the UI.

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8
Create Date: 2026-06-16
"""
import sqlalchemy as sa
from alembic import op

revision = "c5d6e7f8a9b0"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("manager_user_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("stores", sa.Column("color", sa.String(9), nullable=True))
    op.create_foreign_key(
        "fk_stores_manager_user_id_users",
        "stores",
        "users",
        ["manager_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_stores_manager_user_id_users", "stores", type_="foreignkey")
    op.drop_column("stores", "color")
    op.drop_column("stores", "manager_user_id")
