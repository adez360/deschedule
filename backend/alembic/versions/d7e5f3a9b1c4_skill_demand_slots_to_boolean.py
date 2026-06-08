"""skill_demand_slots_to_boolean

Revision ID: d7e5f3a9b1c4
Revises: c4d8a1f6e2b3
Create Date: 2026-06-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd7e5f3a9b1c4'
down_revision: Union[str, None] = 'c4d8a1f6e2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Convert StoreSkillDemand.slots from int[7][24] (required headcount) to
# boolean[7][24] (simple "is this skill needed in this slot" tag), per IDEA-02.
# Each cell value v becomes (v > 0). Implemented as a JSONB-native transform:
# for each day-array, build a new array where each hour element is replaced by
# a boolean derived from the original integer via a CASE expression.

_UPGRADE_SQL = """
    UPDATE store_skill_demands
    SET slots = (
        SELECT jsonb_agg(
            (
                SELECT jsonb_agg(
                    CASE WHEN (hour_elem)::numeric > 0 THEN to_jsonb(true) ELSE to_jsonb(false) END
                    ORDER BY hour_idx
                )
                FROM jsonb_array_elements(day_elem) WITH ORDINALITY AS h(hour_elem, hour_idx)
            )
            ORDER BY day_idx
        )
        FROM jsonb_array_elements(slots) WITH ORDINALITY AS d(day_elem, day_idx)
    )
"""

_DOWNGRADE_SQL = """
    UPDATE store_skill_demands
    SET slots = (
        SELECT jsonb_agg(
            (
                SELECT jsonb_agg(
                    CASE WHEN (hour_elem)::boolean THEN to_jsonb(1) ELSE to_jsonb(0) END
                    ORDER BY hour_idx
                )
                FROM jsonb_array_elements(day_elem) WITH ORDINALITY AS h(hour_elem, hour_idx)
            )
            ORDER BY day_idx
        )
        FROM jsonb_array_elements(slots) WITH ORDINALITY AS d(day_elem, day_idx)
    )
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
