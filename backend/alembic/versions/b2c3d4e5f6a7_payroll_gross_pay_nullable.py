"""payroll_reports: make gross_pay nullable (CUSTOM contracts track hours, no pay)

Revision ID: b2c3d4e5f6a7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-09

"""
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("payroll_reports", "gross_pay", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE payroll_reports SET gross_pay = 0 WHERE gross_pay IS NULL")
    op.alter_column("payroll_reports", "gross_pay", nullable=False)
