"""add_calendar_token_and_assignment_updated_at

Revision ID: fa1a6af895fb
Revises: 57e81c50b638
Create Date: 2026-06-04 06:21:14.012008

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa1a6af895fb'
down_revision: Union[str, None] = '57e81c50b638'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assignments', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.create_foreign_key('fk_organizations_owner_user_id', 'organizations', 'users', ['owner_user_id'], ['id'], use_alter=True)
    # Add as nullable first, backfill existing rows, then set NOT NULL
    op.add_column('users', sa.Column('calendar_token', sa.UUID(), nullable=True))
    op.execute("UPDATE users SET calendar_token = gen_random_uuid() WHERE calendar_token IS NULL")
    op.alter_column('users', 'calendar_token', nullable=False)
    op.create_unique_constraint('uq_users_calendar_token', 'users', ['calendar_token'])


def downgrade() -> None:
    op.drop_constraint('uq_users_calendar_token', 'users', type_='unique')
    op.drop_column('users', 'calendar_token')
    op.drop_constraint('fk_organizations_owner_user_id', 'organizations', type_='foreignkey')
    op.drop_column('assignments', 'updated_at')
