"""
Phase 1: greedy scheduler.
Phase 3 will replace run_greedy() with OR-Tools CP-SAT while keeping the same interface.
"""
import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.availability import Availability, StorePreference
from app.models.demand import DemandTemplate
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.user import User

DAILY_HOUR_MAX = 8


async def load_inputs(
    store_id: uuid.UUID,
    week_start: date,
    db: AsyncSession,
) -> tuple[
    list[list[int]],
    list[uuid.UUID],
    dict[uuid.UUID, list[list[bool]]],
    dict[uuid.UUID, float],
]:
    """
    Returns (demand_slots, user_ids, avail_slots, pref_weights).
    All DB loading is batched to minimise round-trips.
    """
    # ── Demand ────────────────────────────────────────────────────────────────
    demand_result = await db.execute(
        select(DemandTemplate).where(
            DemandTemplate.store_id == store_id,
            DemandTemplate.week_start == week_start,
        )
    )
    demand = demand_result.scalar_one_or_none()
    demand_slots: list[list[int]] = demand.slots if demand else [[0] * 24 for _ in range(7)]

    # ── Employees in this store ───────────────────────────────────────────────
    emp_result = await db.execute(
        select(User)
        .distinct()
        .join(UserRoleGroup, UserRoleGroup.user_id == User.id)
        .join(RoleGroup, RoleGroup.id == UserRoleGroup.role_group_id)
        .where(RoleGroup.store_id == store_id, User.is_active.is_(True))
    )
    employees = emp_result.scalars().all()
    user_ids = [e.id for e in employees]

    if not user_ids:
        return demand_slots, [], {}, {}

    # ── Availability (batch: specific week + default templates) ───────────────
    avail_result = await db.execute(
        select(Availability).where(
            Availability.user_id.in_(user_ids),
            or_(
                Availability.week_start == week_start,
                Availability.is_default_template.is_(True),
            ),
        )
    )
    specific: dict[uuid.UUID, list[list[bool]]] = {}
    template: dict[uuid.UUID, list[list[bool]]] = {}
    for av in avail_result.scalars().all():
        if av.week_start == week_start:
            specific[av.user_id] = av.slots
        elif av.is_default_template and av.user_id not in template:
            template[av.user_id] = av.slots

    avail_slots: dict[uuid.UUID, list[list[bool]]] = {
        uid: specific.get(uid) or template.get(uid) or [[False] * 24 for _ in range(7)]
        for uid in user_ids
    }

    # ── Store preferences ─────────────────────────────────────────────────────
    pref_result = await db.execute(
        select(StorePreference).where(
            StorePreference.user_id.in_(user_ids),
            StorePreference.store_id == store_id,
        )
    )
    pref_weights: dict[uuid.UUID, float] = {p.user_id: p.weight for p in pref_result.scalars()}
    for uid in user_ids:
        pref_weights.setdefault(uid, 0.5)  # neutral default for employees with no preference set

    return demand_slots, user_ids, avail_slots, pref_weights


def run_greedy(
    user_ids: list[uuid.UUID],
    demand_slots: list[list[int]],
    avail_slots: dict[uuid.UUID, list[list[bool]]],
    pref_weights: dict[uuid.UUID, float],
) -> list[dict]:
    """
    Pure function — no I/O. Iterates slots day-by-hour, picks the highest-preference
    available employees up to the required headcount.

    Returns list of {"user_id", "day", "hour"}.
    """
    daily_hours: dict[uuid.UUID, list[int]] = {uid: [0] * 7 for uid in user_ids}
    assignments: list[dict] = []

    for day in range(7):
        for hour in range(24):
            required = demand_slots[day][hour]
            if required <= 0:
                continue

            candidates = sorted(
                [
                    uid for uid in user_ids
                    if avail_slots[uid][day][hour]
                    and daily_hours[uid][day] < DAILY_HOUR_MAX
                ],
                key=lambda uid: pref_weights[uid],
                reverse=True,
            )

            for uid in candidates[:required]:
                assignments.append({"user_id": uid, "day": day, "hour": hour})
                daily_hours[uid][day] += 1

    return assignments
