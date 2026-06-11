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
from app.services.scheduler import load_inputs, run_greedy

router = APIRouter(tags=["schedules"])


async def _get_store_and_check(store_id: uuid.UUID, user: User, db: AsyncSession) -> Store:
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(user, store.organization_id, db)
    return store


async def _get_schedule_with_assignments(schedule_id: uuid.UUID, db: AsyncSession) -> Schedule:
    result = await db.execute(
        select(Schedule)
        .options(selectinload(Schedule.assignments))
        .where(Schedule.id == schedule_id)
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
    "/stores/{store_id}/schedules/generate",
    response_model=ScheduleWithAssignments,
    status_code=status.HTTP_201_CREATED,
)
async def generate_schedule(
    store_id: uuid.UUID,
    body: GenerateScheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Run the greedy scheduler for the given week.
    - If no schedule exists yet: creates a draft.
    - If a draft exists: deletes non-manual assignments and reruns.
    - Published / archived schedules cannot be regenerated.
    """
    await _get_store_and_check(store_id, current_user, db)
    await assert_permission(current_user, "org.schedule.arrange", db)

    existing = await db.execute(
        select(Schedule).where(
            Schedule.store_id == store_id,
            Schedule.week_start == body.week_start,
        )
    )
    schedule = existing.scalar_one_or_none()

    if schedule:
        if schedule.status != ScheduleStatus.DRAFT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot regenerate a '{schedule.status}' schedule",
            )
        # Keep manual assignments, discard auto-generated ones
        await db.execute(
            delete(Assignment).where(
                Assignment.schedule_id == schedule.id,
                Assignment.is_manual.is_(False),
            )
        )
    else:
        schedule = Schedule(store_id=store_id, week_start=body.week_start)
        db.add(schedule)
        await db.flush()  # resolve schedule.id before adding children

    demand_slots, user_ids, avail_slots, pref_weights, skill_demand_slots, user_skills = await load_inputs(
        store_id, body.week_start, db
    )
    raw = run_greedy(
        user_ids, demand_slots, avail_slots, pref_weights, skill_demand_slots, user_skills
    )

    for a in raw:
        db.add(Assignment(
            schedule_id=schedule.id,
            user_id=a["user_id"],
            store_id=store_id,
            day=a["day"],
            hour=a["hour"],
            is_manual=False,
        ))

    await db.commit()
    return ScheduleWithAssignments.model_validate(
        await _get_schedule_with_assignments(schedule.id, db)
    )


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
