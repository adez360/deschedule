"""add_skill_system

Revision ID: c4d8a1f6e2b3
Revises: 8b2e4d6f1a90
Create Date: 2026-06-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c4d8a1f6e2b3'
down_revision: Union[str, None] = '8b2e4d6f1a90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'skills',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', 'name', name='uq_skill_org_name'),
    )
    op.create_index(op.f('ix_skills_organization_id'), 'skills', ['organization_id'])

    op.create_table(
        'user_skills',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('skill_id', sa.UUID(), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id']),
        sa.PrimaryKeyConstraint('user_id', 'skill_id'),
    )

    op.create_table(
        'store_skill_demands',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('store_id', sa.UUID(), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('skill_id', sa.UUID(), nullable=False),
        sa.Column('slots', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id']),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('store_id', 'week_start', 'skill_id', name='uq_skill_demand_store_week_skill'),
    )
    op.create_index(op.f('ix_store_skill_demands_store_id'), 'store_skill_demands', ['store_id'])

    # Seed default skills (日結帳 / 補貨 / 關店 / 開店) for every existing organization
    op.execute("""
        INSERT INTO skills (id, organization_id, name, created_at)
        SELECT gen_random_uuid(), o.id, s.name, now()
        FROM organizations o
        CROSS JOIN (VALUES ('日結帳'), ('補貨'), ('關店'), ('開店')) AS s(name)
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_store_skill_demands_store_id'), table_name='store_skill_demands')
    op.drop_table('store_skill_demands')
    op.drop_table('user_skills')
    op.drop_index(op.f('ix_skills_organization_id'), table_name='skills')
    op.drop_table('skills')
