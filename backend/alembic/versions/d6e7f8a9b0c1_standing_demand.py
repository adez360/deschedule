"""Standing demand tables — drop week_start (IDEA-15)

Demand becomes a standing table: one row per store (and one per (store, skill)
for skill sub-demand), applied to every week. Collapses any existing per-week
rows down to the most recently updated row per store / per (store, skill).

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-06-17
"""
import sqlalchemy as sa
from alembic import op

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── demand_templates: keep one row per store (latest updated_at wins) ──────
    op.execute(
        """
        DELETE FROM demand_templates a
        USING demand_templates b
        WHERE a.store_id = b.store_id
          AND (a.updated_at < b.updated_at
               OR (a.updated_at = b.updated_at AND a.id < b.id))
        """
    )
    op.drop_constraint("uq_demand_store_week", "demand_templates", type_="unique")
    op.drop_column("demand_templates", "week_start")
    op.create_unique_constraint("uq_demand_store", "demand_templates", ["store_id"])

    # ── store_skill_demands: keep one row per (store, skill) ───────────────────
    op.execute(
        """
        DELETE FROM store_skill_demands a
        USING store_skill_demands b
        WHERE a.store_id = b.store_id
          AND a.skill_id = b.skill_id
          AND (a.updated_at < b.updated_at
               OR (a.updated_at = b.updated_at AND a.id < b.id))
        """
    )
    op.drop_constraint("uq_skill_demand_store_week_skill", "store_skill_demands", type_="unique")
    op.drop_column("store_skill_demands", "week_start")
    op.create_unique_constraint(
        "uq_skill_demand_store_skill", "store_skill_demands", ["store_id", "skill_id"]
    )


def downgrade() -> None:
    # Re-introduce week_start, backfilling existing standing rows with the current
    # ISO week's Monday (date_trunc('week', ...) returns Monday in Postgres).
    op.drop_constraint("uq_demand_store", "demand_templates", type_="unique")
    op.add_column("demand_templates", sa.Column("week_start", sa.Date(), nullable=True))
    op.execute("UPDATE demand_templates SET week_start = date_trunc('week', now())::date")
    op.alter_column("demand_templates", "week_start", nullable=False)
    op.create_unique_constraint(
        "uq_demand_store_week", "demand_templates", ["store_id", "week_start"]
    )

    op.drop_constraint("uq_skill_demand_store_skill", "store_skill_demands", type_="unique")
    op.add_column("store_skill_demands", sa.Column("week_start", sa.Date(), nullable=True))
    op.execute("UPDATE store_skill_demands SET week_start = date_trunc('week', now())::date")
    op.alter_column("store_skill_demands", "week_start", nullable=False)
    op.create_unique_constraint(
        "uq_skill_demand_store_week_skill",
        "store_skill_demands",
        ["store_id", "week_start", "skill_id"],
    )
