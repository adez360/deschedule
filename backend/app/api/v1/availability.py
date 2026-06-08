import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.availability import Availability
from app.models.user import User
from app.schemas.availability import AvailabilityResponse, AvailabilitySet

router = APIRouter(tags=["availability"])


def _assert_monday(d: date) -> None:
    if d.weekday() != 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="week_start must be a Monday",
        )


async def _unset_default_template(user_id: uuid.UUID, db: AsyncSession) -> None:
    result = await db.execute(
        select(Availability).where(
            Availability.user_id == user_id,
            Availability.is_default_template.is_(True),
        )
    )
    for av in result.scalars().all():
        av.is_default_template = False


async def _get_weeks(
    user_id: uuid.UUID,
    week_starts: list[date],
    db: AsyncSession,
) -> list[Availability]:
    result = await db.execute(
        select(Availability).where(
            Availability.user_id == user_id,
            Availability.week_start.in_(week_starts),
        )
    )
    return result.scalars().all()


# ── /users/me/availability ─────────────────────────────────────────────────────

@router.get("/users/me/availability", response_model=list[AvailabilityResponse])
async def get_my_availability(
    week: date | None = None,
    from_date: date | None = None,
    weeks: int = 4,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    ?week=YYYY-MM-DD          → single week
    ?from_date=YYYY-MM-DD&weeks=4  → multiple weeks (up to 8)
    No params                 → next 4 weeks from today's Monday
    """
    if week:
        _assert_monday(week)
        return await _get_weeks(current_user.id, [week], db)

    if weeks < 1 or weeks > 8:
        raise HTTPException(status_code=422, detail="weeks must be between 1 and 8")

    if from_date:
        _assert_monday(from_date)
        start = from_date
    else:
        today = date.today()
        start = today - timedelta(days=today.weekday())

    week_starts = [start + timedelta(weeks=i) for i in range(weeks)]
    return await _get_weeks(current_user.id, week_starts, db)


@router.put("/users/me/availability/{week_start}", response_model=AvailabilityResponse)
async def set_my_availability(
    week_start: date,
    body: AvailabilitySet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_monday(week_start)
    await assert_permission(current_user, "self.availability.edit", db)

    result = await db.execute(
        select(Availability).where(
            Availability.user_id == current_user.id,
            Availability.week_start == week_start,
        )
    )
    av = result.scalar_one_or_none()

    if av and av.locked:
        raise HTTPException(status_code=423, detail="Availability is locked")

    if body.is_default_template:
        await _unset_default_template(current_user.id, db)

    if av:
        av.slots = body.slots
        av.is_default_template = body.is_default_template
    else:
        av = Availability(
            user_id=current_user.id,
            week_start=week_start,
            slots=body.slots,
            is_default_template=body.is_default_template,
        )
        db.add(av)

    await db.commit()
    await db.refresh(av)
    return av


# ── /users/{user_id}/availability  (admin) ────────────────────────────────────

@router.get("/users/{user_id}/availability", response_model=list[AvailabilityResponse])
async def get_user_availability(
    user_id: uuid.UUID,
    week: date | None = None,
    from_date: date | None = None,
    weeks: int = 4,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.availability.edit", db)

    if week:
        _assert_monday(week)
        return await _get_weeks(user_id, [week], db)

    if weeks < 1 or weeks > 8:
        raise HTTPException(status_code=422, detail="weeks must be between 1 and 8")

    if from_date:
        _assert_monday(from_date)
        start = from_date
    else:
        today = date.today()
        start = today - timedelta(days=today.weekday())

    week_starts = [start + timedelta(weeks=i) for i in range(weeks)]
    return await _get_weeks(user_id, week_starts, db)


@router.put("/users/{user_id}/availability/{week_start}", response_model=AvailabilityResponse)
async def set_user_availability(
    user_id: uuid.UUID,
    week_start: date,
    body: AvailabilitySet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin override — can write even if locked."""
    _assert_monday(week_start)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.availability.edit", db)

    result = await db.execute(
        select(Availability).where(
            Availability.user_id == user_id,
            Availability.week_start == week_start,
        )
    )
    av = result.scalar_one_or_none()

    if body.is_default_template:
        await _unset_default_template(user_id, db)

    if av:
        av.slots = body.slots
        av.is_default_template = body.is_default_template
    else:
        av = Availability(
            user_id=user_id,
            week_start=week_start,
            slots=body.slots,
            is_default_template=body.is_default_template,
        )
        db.add(av)

    await db.commit()
    await db.refresh(av)
    return av


@router.patch("/users/{user_id}/availability/{week_start}/lock", response_model=AvailabilityResponse)
async def set_lock(
    user_id: uuid.UUID,
    week_start: date,
    locked: bool,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_monday(week_start)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.availability.edit", db)

    result = await db.execute(
        select(Availability).where(
            Availability.user_id == user_id,
            Availability.week_start == week_start,
        )
    )
    av = result.scalar_one_or_none()
    if not av:
        raise HTTPException(status_code=404, detail="Availability not found")

    av.locked = locked
    await db.commit()
    await db.refresh(av)
    return av
