"""user profile fields: nickname / avatar_url / note / hire_date (IDEA-07)

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-11

nickname is backfilled from name and set NOT NULL.
"""
import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname", sa.String(length=255), nullable=True))
    op.execute("UPDATE users SET nickname = name WHERE nickname IS NULL")
    op.alter_column("users", "nickname", nullable=False)
    op.add_column("users", sa.Column("avatar_url", sa.String(length=1024), nullable=True))
    op.add_column("users", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("hire_date", sa.Date(), nullable=True))

    # Grant employee.identity.view to existing management role groups so current
    # managers keep seeing real names after the visibility rule lands.
    op.execute(
        """
        UPDATE role_groups
        SET permissions = array_append(permissions, 'employee.identity.view')
        WHERE permissions && ARRAY['org.manage', 'org.employee.manage', 'system.all']::varchar[]
          AND NOT ('employee.identity.view' = ANY(permissions))
        """
    )


def downgrade() -> None:
    op.drop_column("users", "hire_date")
    op.drop_column("users", "note")
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "nickname")
