"""contract_pay_terms_redesign

Revision ID: 8b2e4d6f1a90
Revises: 73f7f59a9c8a
Create Date: 2026-06-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8b2e4d6f1a90'
down_revision: Union[str, None] = '73f7f59a9c8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # employee_contracts: split pay terms by contract type
    op.add_column('employee_contracts', sa.Column('monthly_salary', sa.Numeric(10, 2), nullable=True))
    op.alter_column('employee_contracts', 'hourly_rate', existing_type=sa.Numeric(10, 2), nullable=True)
    op.drop_column('employee_contracts', 'weekly_hour_min')
    op.drop_column('employee_contracts', 'weekly_hour_max')
    # CUSTOM contracts carry no pay terms — clear any existing test rates for them
    op.execute("UPDATE employee_contracts SET hourly_rate = NULL WHERE contract_type = 'CUSTOM'")

    # payroll_reports: snapshot needs to support either monthly_salary or hourly_rate
    op.add_column('payroll_reports', sa.Column('contract_type', sa.Enum('FT', 'PT', 'CUSTOM', name='contracttype'), nullable=True))
    op.add_column('payroll_reports', sa.Column('monthly_salary_snapshot', sa.Numeric(10, 2), nullable=True))
    op.alter_column('payroll_reports', 'hourly_rate_snapshot', existing_type=sa.Numeric(10, 2), nullable=True)
    op.execute("UPDATE payroll_reports SET contract_type = 'PT' WHERE contract_type IS NULL")
    op.alter_column('payroll_reports', 'contract_type', existing_type=sa.Enum('FT', 'PT', 'CUSTOM', name='contracttype'), nullable=False)


def downgrade() -> None:
    op.alter_column('payroll_reports', 'hourly_rate_snapshot', existing_type=sa.Numeric(10, 2), nullable=False)
    op.drop_column('payroll_reports', 'monthly_salary_snapshot')
    op.drop_column('payroll_reports', 'contract_type')

    op.add_column('employee_contracts', sa.Column('weekly_hour_max', sa.Integer(), nullable=False, server_default='40'))
    op.add_column('employee_contracts', sa.Column('weekly_hour_min', sa.Integer(), nullable=True))
    op.alter_column('employee_contracts', 'hourly_rate', existing_type=sa.Numeric(10, 2), nullable=False)
    op.drop_column('employee_contracts', 'monthly_salary')
