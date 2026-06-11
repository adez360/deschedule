"""contracts: drop store_id (contracts are now cross-store / org-level)

Revision ID: e1f2a3b4c5d6
Revises: d7e5f3a9b1c4
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e1f2a3b4c5d6"
down_revision = "d7e5f3a9b1c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "employee_contracts_store_id_fkey",
        "employee_contracts",
        type_="foreignkey",
    )
    op.drop_column("employee_contracts", "store_id")


def downgrade() -> None:
    op.add_column(
        "employee_contracts",
        sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "employee_contracts_store_id_fkey",
        "employee_contracts",
        "stores",
        ["store_id"],
        ["id"],
    )
