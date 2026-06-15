"""
Phase 2: org-level joint greedy scheduler (IDEA-10).

One run schedules every store in the organization for the week, so cross-store
mutual exclusion (one employee, one store per hour) is built in. Coverage is
maximised first (B2), with preference weight as the tie-breaker. Published /
archived schedules and manual draft assignments are passed in as fixed
occupancy and never changed (D).

Cross-store scope (G1): stores sharing the same non-null ``Store.cross_group``
label form a group; an employee anchored at a home store may only be scheduled
at that store and at stores in its group. Employees without a home store float
across every store their role groups cover (legacy behaviour).

Phase 3 will replace run_greedy_org() with OR-Tools CP-SAT keeping the same
interface.
"""
import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.availability import Availability, AvailabilityTemplate, StorePreference
from app.models.demand import DemandTemplate
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.skill import StoreSkillDemand, UserSkill
from app.models.store import Store
from app.models.user import User

DAILY_HOUR_MAX = 8


@dataclass
class OrgScheduleInputs:
    store_ids: list[uuid.UUID]                                   # org stores, creation order
    demand: dict[uuid.UUID, list[list[int]]]                     # store → [7][24] headcount
    user_ids: list[uuid.UUID]
    eligible: dict[uuid.UUID, set[uuid.UUID]]                    # user → stores they may work at
    avail: dict[uuid.UUID, list[list[bool]]]                     # user → [7][24]
    pref: dict[uuid.UUID, dict[uuid.UUID, float]]                # user → store → weight
    skill_demand: dict[uuid.UUID, dict[uuid.UUID, list[list[bool]]]]  # store → skill → [7][24]
    user_skills: dict[uuid.UUID, set[uuid.UUID]] = field(default_factory=dict)
    daily_caps: dict[uuid.UUID, int] = field(default_factory=dict)


async def load_org_inputs(
    organization_id: uuid.UUID,
    week_start: date,
    db: AsyncSession,
) -> OrgScheduleInputs:
    """Batch-load demand, candidates, availability, preferences and skills for
    every store in the organization."""
    stores_result = await db.execute(
        select(Store)
        .where(Store.organization_id == organization_id)
        .order_by(Store.created_at)
    )
    stores = stores_result.scalars().all()
    store_ids = [s.id for s in stores]
    store_id_set = set(store_ids)
    cross_group_of = {s.id: s.cross_group for s in stores}

    empty_demand = lambda: [[0] * 24 for _ in range(7)]  # noqa: E731

    # ── Demand (headcount) per store ──────────────────────────────────────────
    demand_result = await db.execute(
        select(DemandTemplate).where(
            DemandTemplate.store_id.in_(store_ids),
            DemandTemplate.week_start == week_start,
        )
    )
    demand: dict[uuid.UUID, list[list[int]]] = {sid: empty_demand() for sid in store_ids}
    for d in demand_result.scalars().all():
        demand[d.store_id] = d.slots

    # ── Candidates + per-user role-group store coverage ───────────────────────
    emp_result = await db.execute(
        select(User, RoleGroup.store_ids)
        .join(UserRoleGroup, UserRoleGroup.user_id == User.id)
        .join(RoleGroup, RoleGroup.id == UserRoleGroup.role_group_id)
        .where(
            RoleGroup.organization_id == organization_id,
            User.is_active.is_(True),
        )
    )
    users: dict[uuid.UUID, User] = {}
    coverage: dict[uuid.UUID, set[uuid.UUID]] = {}
    for user, rg_store_ids in emp_result.all():
        users[user.id] = user
        cov = coverage.setdefault(user.id, set())
        # store_ids=[] means the role group is org-level → covers every store
        cov.update(store_id_set if not rg_store_ids else (set(rg_store_ids) & store_id_set))
    user_ids = list(users)

    # ── G1 cross-group filter, anchored on the employee's home store ──────────
    eligible: dict[uuid.UUID, set[uuid.UUID]] = {}
    for uid in user_ids:
        cov = coverage[uid]
        home = users[uid].home_store_id
        if home in store_id_set:
            grp = cross_group_of[home]
            allowed = {home}
            if grp is not None:
                allowed |= {sid for sid in store_ids if cross_group_of[sid] == grp}
            eligible[uid] = cov & allowed
        else:
            eligible[uid] = cov  # no home store → floats across role-group coverage

    daily_caps = {uid: users[uid].daily_hour_max or DAILY_HOUR_MAX for uid in user_ids}

    # ── Skill sub-demand per store ─────────────────────────────────────────────
    skill_demand_result = await db.execute(
        select(StoreSkillDemand).where(
            StoreSkillDemand.store_id.in_(store_ids),
            StoreSkillDemand.week_start == week_start,
        )
    )
    skill_demand: dict[uuid.UUID, dict[uuid.UUID, list[list[bool]]]] = {}
    for sd in skill_demand_result.scalars().all():
        skill_demand.setdefault(sd.store_id, {})[sd.skill_id] = sd.slots

    if not user_ids:
        return OrgScheduleInputs(store_ids, demand, [], {}, {}, {}, skill_demand)

    # ── Availability (specific week, falling back to standing template) ───────
    avail_result = await db.execute(
        select(Availability).where(
            Availability.user_id.in_(user_ids),
            Availability.week_start == week_start,
        )
    )
    specific: dict[uuid.UUID, list[list[bool]]] = {
        av.user_id: av.slots for av in avail_result.scalars().all()
    }
    template_result = await db.execute(
        select(AvailabilityTemplate).where(AvailabilityTemplate.user_id.in_(user_ids))
    )
    template: dict[uuid.UUID, list[list[bool]]] = {
        t.user_id: t.slots for t in template_result.scalars().all()
    }
    avail = {
        uid: specific.get(uid) or template.get(uid) or [[False] * 24 for _ in range(7)]
        for uid in user_ids
    }

    # ── Store preferences ─────────────────────────────────────────────────────
    pref_result = await db.execute(
        select(StorePreference).where(
            StorePreference.user_id.in_(user_ids),
            StorePreference.store_id.in_(store_ids),
        )
    )
    pref: dict[uuid.UUID, dict[uuid.UUID, float]] = {uid: {} for uid in user_ids}
    for p in pref_result.scalars().all():
        pref[p.user_id][p.store_id] = p.weight

    # ── Employee skills ────────────────────────────────────────────────────────
    user_skills: dict[uuid.UUID, set[uuid.UUID]] = {uid: set() for uid in user_ids}
    if skill_demand:
        skill_result = await db.execute(
            select(UserSkill).where(UserSkill.user_id.in_(user_ids))
        )
        for us in skill_result.scalars().all():
            user_skills[us.user_id].add(us.skill_id)

    return OrgScheduleInputs(
        store_ids, demand, user_ids, eligible, avail, pref, skill_demand, user_skills, daily_caps
    )


def run_greedy_org(
    inputs: OrgScheduleInputs,
    target_store_ids: list[uuid.UUID],
    fixed: list[dict] | None = None,
) -> list[dict]:
    """
    Pure function — no I/O. Jointly fills every target store slot by slot.

    ``fixed`` assignments ({"user_id", "store_id", "day", "hour"}) are immovable:
    they occupy the employee's hour everywhere, count toward daily caps, and —
    when their store is a target — toward that store's headcount and skill
    coverage. Per slot:

    1. skill pass — each unmet skill requirement gets one qualified candidate
       (highest preference weight first);
    2. general pass — (user, store) pairs sorted by weight desc, then larger
       gap, then store creation order; one store per user per hour;
    3. augment pass — a still-gapped store may pull an eligible user out of
       another store's general-pass picks when that store has a free substitute
       (coverage-first, B2).

    Returns list of {"user_id", "store_id", "day", "hour"}.
    """
    fixed = fixed or []
    target_set = set(target_store_ids)
    store_order = {sid: i for i, sid in enumerate(inputs.store_ids)}
    targets = [sid for sid in inputs.store_ids if sid in target_set]

    occupied: list[list[set[uuid.UUID]]] = [[set() for _ in range(24)] for _ in range(7)]
    daily_hours: dict[uuid.UUID, list[int]] = {uid: [0] * 7 for uid in inputs.user_ids}
    fixed_count: dict[uuid.UUID, list[list[int]]] = {
        sid: [[0] * 24 for _ in range(7)] for sid in targets
    }
    fixed_at: dict[tuple[uuid.UUID, int, int], list[uuid.UUID]] = {}

    for f in fixed:
        occupied[f["day"]][f["hour"]].add(f["user_id"])
        if f["user_id"] in daily_hours:
            daily_hours[f["user_id"]][f["day"]] += 1
        if f["store_id"] in target_set:
            fixed_count[f["store_id"]][f["day"]][f["hour"]] += 1
            fixed_at.setdefault((f["store_id"], f["day"], f["hour"]), []).append(f["user_id"])

    def weight(uid: uuid.UUID, sid: uuid.UUID) -> float:
        return inputs.pref.get(uid, {}).get(sid, 0.5)

    assignments: list[dict] = []

    for day in range(7):
        for hour in range(24):
            remaining: dict[uuid.UUID, int] = {}
            for sid in targets:
                gap = inputs.demand[sid][day][hour] - fixed_count[sid][day][hour]
                if gap > 0:
                    remaining[sid] = gap
            if not remaining:
                continue

            def free(uid: uuid.UUID) -> bool:
                return (
                    inputs.avail[uid][day][hour]
                    and uid not in occupied[day][hour]
                    and daily_hours[uid][day] < inputs.daily_caps.get(uid, DAILY_HOUR_MAX)
                )

            assigned_now: dict[uuid.UUID, uuid.UUID] = {}  # user → store
            movable: set[uuid.UUID] = set()  # general-pass picks; augment may relocate

            # ── 1. skill pass ──────────────────────────────────────────────
            for sid in sorted(remaining, key=lambda s: (-remaining[s], store_order[s])):
                for skill_id, slots in inputs.skill_demand.get(sid, {}).items():
                    if not slots[day][hour] or remaining[sid] <= 0:
                        continue
                    present = fixed_at.get((sid, day, hour), []) + [
                        u for u, s2 in assigned_now.items() if s2 == sid
                    ]
                    if any(skill_id in inputs.user_skills.get(u, set()) for u in present):
                        continue
                    qualified = [
                        u for u in inputs.user_ids
                        if u not in assigned_now and free(u)
                        and sid in inputs.eligible[u]
                        and skill_id in inputs.user_skills.get(u, set())
                    ]
                    if qualified:
                        best = max(qualified, key=lambda u: weight(u, sid))
                        assigned_now[best] = sid
                        remaining[sid] -= 1

            # ── 2. general pass ────────────────────────────────────────────
            pairs = [
                (uid, sid)
                for uid in inputs.user_ids
                for sid in remaining
                if sid in inputs.eligible[uid]
            ]
            pairs.sort(key=lambda p: (-weight(*p), -remaining[p[1]], store_order[p[1]]))
            for uid, sid in pairs:
                if remaining[sid] <= 0 or uid in assigned_now or not free(uid):
                    continue
                assigned_now[uid] = sid
                remaining[sid] -= 1
                movable.add(uid)

            # ── 3. augment pass (coverage-first) ───────────────────────────
            for sid in [s for s in targets if remaining.get(s, 0) > 0]:
                progress = True
                while remaining[sid] > 0 and progress:
                    progress = False
                    for uid in sorted(movable, key=lambda u: -weight(u, sid)):
                        other = assigned_now[uid]
                        if other == sid or sid not in inputs.eligible[uid]:
                            continue
                        substitutes = [
                            v for v in inputs.user_ids
                            if v not in assigned_now and free(v) and other in inputs.eligible[v]
                        ]
                        if not substitutes:
                            continue
                        sub = max(substitutes, key=lambda v: weight(v, other))
                        assigned_now[uid] = sid
                        remaining[sid] -= 1
                        movable.discard(uid)
                        assigned_now[sub] = other  # swap: `other` keeps its headcount
                        progress = True
                        break

            for uid, sid in assigned_now.items():
                assignments.append({"user_id": uid, "store_id": sid, "day": day, "hour": hour})
                daily_hours[uid][day] += 1
                occupied[day][hour].add(uid)

    return assignments
