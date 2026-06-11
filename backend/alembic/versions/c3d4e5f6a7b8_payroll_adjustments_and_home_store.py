"""payroll adjustments table + users.home_store_id (IDEA-06)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-11

- users.home_store_id: FT monthly salary is attributed only to this store in reports
- payroll_adjustments: per-(user, year, month) signed line items (其他項目)

"""
import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("home_store_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_home_store_id_stores",
        "users",
        "stores",
        ["home_store_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "payroll_adjustments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="TWD"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_payroll_adjustments_user_id", "payroll_adjustments", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_payroll_adjustments_user_id", table_name="payroll_adjustments")
    op.drop_table("payroll_adjustments")
    op.drop_constraint("fk_users_home_store_id_stores", "users", type_="foreignkey")
    op.drop_column("users", "home_store_id")
