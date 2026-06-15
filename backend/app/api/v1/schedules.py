import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.schedule import Assignment, Schedule, ScheduleStatus
from app.models.store import Store
from app.models.user import User
from app.schemas.schedule import (
    AssignmentCreate,
    AssignmentResponse,
    AssignmentUpdate,
    GenerateScheduleRequest,
    ScheduleResponse,
    ScheduleStatusUpdate,
    ScheduleWithAssignments,
)
from app.services.payroll import create_payroll_reports
from app.services.scheduler import load_org_inputs, run_greedy_org

router = APIRouter(tags=["schedules"])


async def _get_store_and_check(store_id: uuid.UUID, user: User, db: AsyncSession) -> Store:
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(user, store.organization_id, db)
    return store


async def _get_schedule_with_assignments(schedule_id: uuid.UUID, db: AsyncSession) -> Schedule:
    # populate_existing: the generate endpoint bulk-deletes assignments after the
    # schedule was eager-loaded; with expire_on_commit=False the session would
    # otherwise serve the stale pre-delete collection.
    result = await db.execute(
        select(Schedule)
        .options(selectinload(Schedule.assignments))
        .where(Schedule.id == schedule_id)
        .execution_options(populate_existing=True)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return schedule


# ── Schedule CRUD ──────────────────────────────────────────────────────────────

@router.get("/stores/{store_id}/schedules", response_model=list[ScheduleResponse])
async def list_schedules(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check(store_id, current_user, db)
    result = await db.execute(
        select(Schedule)
        .where(Schedule.store_id == store_id)
        .order_by(Schedule.week_start.desc())
    )
    return result.scalars().all()


@router.get("/schedules/{schedule_id}", response_model=ScheduleWithAssignments)
async def get_schedule(
    schedule_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    schedule = await _get_schedule_with_assignments(schedule_id, db)
    store = await db.get(Store, schedule.store_id)
    await assert_org_access(current_user, store.organization_id, db)
    return ScheduleWithAssignments.model_validate(schedule)


@router.post(
    "/organizations/{org_id}/schedules/generate",
    response_model=list[ScheduleWithAssignments],
    status_code=status.HTTP_201_CREATED,
)
async def generate_org_schedules(
    org_id: uuid.UUID,
    body: GenerateScheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Org-level joint scheduling (IDEA-10): one run fills every store in the
    organization for the given week, so an employee can never be assigned to
    two stores in the same hour.

    Per store: no schedule yet → a draft is created; draft → non-manual
    assignments are regenerated (manual ones kept and treated as fixed);
    published / archived → untouched, but their assignments still occupy
    employees' hours. Returns the (re)generated draft schedules.
    """
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.schedule.arrange", db)

    stores_result = await db.execute(
        select(Store).where(Store.organization_id == org_id).order_by(Store.created_at)
    )
    stores = stores_result.scalars().all()
    if not stores:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No stores in organization")
    store_ids = [s.id for s in stores]

    existing_result = await db.execute(
        select(Schedule)
        .options(selectinload(Schedule.assignments))
        .where(
            Schedule.store_id.in_(store_ids),
            Schedule.week_start == body.week_start,
        )
    )
    by_store = {s.store_id: s for s in existing_result.scalars().all()}

    # Fixed occupancy: every assignment of published/archived schedules,
    # plus manual assignments of drafts (which survive regeneration).
    fixed: list[dict] = []
    draft_schedules: dict[uuid.UUID, Schedule] = {}
    for sid in store_ids:
        schedule = by_store.get(sid)
        if schedule is None:
            schedule = Schedule(store_id=sid, week_start=body.week_start)
            db.add(schedule)
            draft_schedules[sid] = schedule
            continue
        if schedule.status == ScheduleStatus.DRAFT:
            draft_schedules[sid] = schedule
            fixed += [
                {"user_id": a.user_id, "store_id": sid, "day": a.day, "hour": a.hour}
                for a in schedule.assignments if a.is_manual
            ]
        else:
            fixed += [
                {"user_id": a.user_id, "store_id": sid, "day": a.day, "hour": a.hour}
                for a in schedule.assignments
            ]

    await db.flush()  # resolve new schedule ids before adding children

    draft_ids = [s.id for s in draft_schedules.values()]
    await db.execute(
        delete(Assignment).where(
            Assignment.schedule_id.in_(draft_ids),
            Assignment.is_manual.is_(False),
        )
    )

    inputs = await load_org_inputs(org_id, body.week_start, db)
    raw = run_greedy_org(inputs, target_store_ids=list(draft_schedules), fixed=fixed)

    for a in raw:
        db.add(Assignment(
            schedule_id=draft_schedules[a["store_id"]].id,
            user_id=a["user_id"],
            store_id=a["store_id"],
            day=a["day"],
            hour=a["hour"],
            is_manual=False,
        ))

    await db.commit()
    return [
        ScheduleWithAssignments.model_validate(
            await _get_schedule_with_assignments(sched_id, db)
        )
        for sched_id in draft_ids
    ]


@router.patch("/schedules/{schedule_id}/status", response_model=ScheduleResponse)
async def update_schedule_status(
    schedule_id: uuid.UUID,
    body: ScheduleStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    schedule = await db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    store = await db.get(Store, schedule.store_id)
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "store.schedule.edit", db)

    allowed: dict[ScheduleStatus, ScheduleStatus] = {
        ScheduleStatus.DRAFT: ScheduleStatus.PUBLISHED,
        ScheduleStatus.PUBLISHED: ScheduleStatus.ARCHIVED,
    }
    if allowed.get(schedule.status) != body.status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid transition: {schedule.status} → {body.status}",
        )

    schedule.status = body.status
    if body.status == ScheduleStatus.PUBLISHED:
        schedule.published_at = datetime.now(timezone.utc)
    elif body.status == ScheduleStatus.ARCHIVED:
        await create_payroll_reports(schedule, db)

    await db.commit()
    await db.refresh(schedule)
    return schedule


# ── Assignments ────────────────────────────────────────────────────────────────

@router.post(
    "/schedules/{schedule_id}/assignments",
    response_model=AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment(
    schedule_id: uuid.UUID,
    body: AssignmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    schedule = await db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    store = await db.get(Store, schedule.store_id)
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "store.schedule.edit", db)

    dup = await db.execute(
        select(Assignment).where(
            Assignment.schedule_id == schedule_id,
            Assignment.user_id == body.user_id,
            Assignment.day == body.day,
            Assignment.hour == body.hour,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already assigned to this slot")

    assignment = Assignment(
        schedule_id=schedule_id,
        user_id=body.user_id,
        store_id=schedule.store_id,
        day=body.day,
        hour=body.hour,
        is_manual=True,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


@router.patch(
    "/schedules/{schedule_id}/assignments/{assignment_id}",
    response_model=AssignmentResponse,
)
async def update_assignment(
    schedule_id: uuid.UUID,
    assignment_id: uuid.UUID,
    body: AssignmentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Swap the employee in an existing slot; marks the assignment as manual."""
    schedule = await db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    store = await db.get(Store, schedule.store_id)
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "store.schedule.edit", db)

    assignment = await db.get(Assignment, assignment_id)
    if not assignment or assignment.schedule_id != schedule_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    assignment.user_id = body.user_id
    assignment.is_manual = True
    await db.commit()
    await db.refresh(assignment)
    return assignment


@router.delete(
    "/schedules/{schedule_id}/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_assignment(
    schedule_id: uuid.UUID,
    assignment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    schedule = await db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    store = await db.get(Store, schedule.store_id)
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "store.schedule.edit", db)

    assignment = await db.get(Assignment, assignment_id)
    if not assignment or assignment.schedule_id != schedule_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    await db.delete(assignment)
    await db.commit()
