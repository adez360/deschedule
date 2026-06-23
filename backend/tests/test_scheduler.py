"""Unit tests for the org scheduler (greedy + CP-SAT).

Pure-function tests — no DB. Runnable two ways:

    docker compose exec backend python -m pytest tests/test_scheduler.py   # if pytest present
    docker compose exec backend python tests/test_scheduler.py             # standalone runner

Focus: CP-SAT must honour the exact constraint set greedy enforced
(availability, one-store-per-hour, no over-staffing, daily caps, best-effort
skill coverage) and, being optimal, never cover fewer slots than greedy.
"""
import uuid

from app.services.scheduler import (
    DAILY_HOUR_MAX,
    OrgScheduleInputs,
    run_cpsat_org,
    run_greedy_org,
    solve_org_schedule,
)

# ── builders ─────────────────────────────────────────────────────────────────


def _grid(fill=False):
    return [[fill] * 24 for _ in range(7)]


def _demand_grid():
    return [[0] * 24 for _ in range(7)]


def make_inputs(
    store_ids,
    user_ids,
    demand=None,
    avail=None,
    eligible=None,
    pref=None,
    skill_demand=None,
    user_skills=None,
    daily_caps=None,
):
    """Build OrgScheduleInputs with sensible defaults (everyone available &
    eligible everywhere unless overridden)."""
    demand = demand or {s: _demand_grid() for s in store_ids}
    avail = avail or {u: _grid(True) for u in user_ids}
    eligible = eligible or {u: set(store_ids) for u in user_ids}
    pref = pref or {u: {} for u in user_ids}
    skill_demand = skill_demand or {}
    user_skills = user_skills or {u: set() for u in user_ids}
    daily_caps = daily_caps or {u: DAILY_HOUR_MAX for u in user_ids}
    return OrgScheduleInputs(
        store_ids=list(store_ids),
        demand=demand,
        user_ids=list(user_ids),
        eligible=eligible,
        avail=avail,
        pref=pref,
        skill_demand=skill_demand,
        user_skills=user_skills,
        daily_caps=daily_caps,
    )


def _count_at(assignments, store=None, day=None, hour=None):
    return sum(
        1 for a in assignments
        if (store is None or a["store_id"] == store)
        and (day is None or a["day"] == day)
        and (hour is None or a["hour"] == hour)
    )


# ── tests ────────────────────────────────────────────────────────────────────


def test_basic_coverage():
    s = uuid.uuid4()
    u = uuid.uuid4()
    demand = {s: _demand_grid()}
    demand[s][0][0] = 1
    inp = make_inputs([s], [u], demand=demand)
    res = run_cpsat_org(inp, [s])
    assert _count_at(res, store=s, day=0, hour=0) == 1


def test_respects_availability():
    s = uuid.uuid4()
    u = uuid.uuid4()
    demand = {s: _demand_grid()}
    demand[s][0][0] = 1
    inp = make_inputs([s], [u], demand=demand, avail={u: _grid(False)})
    res = run_cpsat_org(inp, [s])
    assert res == []


def test_no_over_staffing():
    s = uuid.uuid4()
    users = [uuid.uuid4() for _ in range(3)]
    demand = {s: _demand_grid()}
    demand[s][0][0] = 1  # only one needed though three are free
    inp = make_inputs([s], users, demand=demand)
    res = run_cpsat_org(inp, [s])
    assert _count_at(res, store=s, day=0, hour=0) == 1


def test_single_store_per_hour():
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    u = uuid.uuid4()
    demand = {s1: _demand_grid(), s2: _demand_grid()}
    demand[s1][0][0] = 1
    demand[s2][0][0] = 1
    inp = make_inputs([s1, s2], [u], demand=demand)
    res = run_cpsat_org(inp, [s1, s2])
    # one employee, two competing slots at the same hour → at most one filled
    assert _count_at(res, day=0, hour=0) == 1


def test_daily_cap():
    s = uuid.uuid4()
    u = uuid.uuid4()
    demand = {s: _demand_grid()}
    for h in range(4):
        demand[s][0][h] = 1
    inp = make_inputs([s], [u], demand=demand, daily_caps={u: 2})
    res = run_cpsat_org(inp, [s])
    assert _count_at(res, store=s, day=0) == 2


def test_fixed_occupancy_blocks_and_counts():
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    u = uuid.uuid4()
    demand = {s1: _demand_grid(), s2: _demand_grid()}
    demand[s1][0][0] = 1
    demand[s2][0][0] = 1
    inp = make_inputs([s1, s2], [u], demand=demand)
    # u is fixed at s1 (0,0): its s1 demand is met, and u can't also take s2
    fixed = [{"user_id": u, "store_id": s1, "day": 0, "hour": 0}]
    res = run_cpsat_org(inp, [s1, s2], fixed=fixed)
    assert res == []  # s1 already covered by fixed; u busy → s2 stays empty


def test_preference_tiebreak():
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    u = uuid.uuid4()
    demand = {s1: _demand_grid(), s2: _demand_grid()}
    demand[s1][0][0] = 1
    demand[s2][0][0] = 1
    # equal coverage either way (one user) → preference decides: prefers s2
    pref = {u: {s1: 0.2, s2: 0.9}}
    inp = make_inputs([s1, s2], [u], demand=demand, pref=pref)
    res = run_cpsat_org(inp, [s1, s2])
    assert _count_at(res, store=s2, day=0, hour=0) == 1
    assert _count_at(res, store=s1, day=0, hour=0) == 0


def test_coverage_beats_preference():
    """U is the only candidate for s2; s1 can be covered by U or V. Coverage-first
    must fill both (U→s2, V→s1) even though U would prefer s1."""
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    u, v = uuid.uuid4(), uuid.uuid4()
    demand = {s1: _demand_grid(), s2: _demand_grid()}
    demand[s1][0][0] = 1
    demand[s2][0][0] = 1
    eligible = {u: {s1, s2}, v: {s1}}  # v cannot work s2
    pref = {u: {s1: 0.9, s2: 0.1}, v: {s1: 0.5}}
    inp = make_inputs([s1, s2], [u, v], demand=demand, eligible=eligible, pref=pref)
    res = run_cpsat_org(inp, [s1, s2])
    assert _count_at(res, store=s1, day=0, hour=0) == 1
    assert _count_at(res, store=s2, day=0, hour=0) == 1  # full coverage wins


def test_skill_coverage_prefers_qualified():
    s = uuid.uuid4()
    skill = uuid.uuid4()
    skilled, plain = uuid.uuid4(), uuid.uuid4()
    demand = {s: _demand_grid()}
    demand[s][0][0] = 1  # one head, slot flagged needing the skill
    sd = {s: {skill: _grid(False)}}
    sd[s][skill][0][0] = True
    inp = make_inputs(
        [s], [skilled, plain],
        demand=demand,
        skill_demand=sd,
        user_skills={skilled: {skill}, plain: set()},
    )
    res = run_cpsat_org(inp, [s])
    assert _count_at(res, store=s, day=0, hour=0) == 1
    assert res[0]["user_id"] == skilled  # qualified employee chosen


def test_cpsat_covers_at_least_as_much_as_greedy():
    """Across a denser scenario, the optimal solver must never cover fewer
    slots than the greedy heuristic."""
    stores = [uuid.uuid4() for _ in range(3)]
    users = [uuid.uuid4() for _ in range(6)]
    demand = {s: _demand_grid() for s in stores}
    for i, s in enumerate(stores):
        for h in range(6):
            demand[s][0][h] = 2
    # staggered availability so coverage is non-trivial
    avail = {}
    for j, u in enumerate(users):
        g = _grid(False)
        for h in range(8):
            g[0][h] = (j + h) % 2 == 0
        avail[u] = g
    pref = {u: {s: round(0.3 + 0.1 * ((i + j) % 5), 2) for i, s in enumerate(stores)}
            for j, u in enumerate(users)}
    inp = make_inputs(stores, users, demand=demand, avail=avail, pref=pref)
    greedy = run_greedy_org(inp, stores)
    cpsat = run_cpsat_org(inp, stores)
    assert len(cpsat) >= len(greedy), (len(cpsat), len(greedy))
    # and CP-SAT must itself be feasible: no user double-booked in an hour
    seen = set()
    for a in cpsat:
        key = (a["user_id"], a["day"], a["hour"])
        assert key not in seen, "double-booked"
        seen.add(key)


def test_dispatcher_uses_cpsat_when_available():
    s = uuid.uuid4()
    u = uuid.uuid4()
    demand = {s: _demand_grid()}
    demand[s][0][0] = 1
    inp = make_inputs([s], [u], demand=demand)
    res = solve_org_schedule(inp, [s], time_limit_s=5.0)
    assert _count_at(res, store=s, day=0, hour=0) == 1


# ── standalone runner (no pytest needed) ─────────────────────────────────────

if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL  {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
