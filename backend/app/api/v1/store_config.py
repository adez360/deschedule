import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.demand import DemandTemplate, ScheduleDeadlineConfig
from app.models.store import Store
from app.models.user import User
from app.schemas.demand import (
    DemandTemplateResponse,
    DemandTemplateSet,
    ScheduleDeadlineConfigResponse,
    ScheduleDeadlineConfigSet,
)

router = APIRouter(tags=["store-config"])


async def _get_store_and_check_access(
    store_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> Store:
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    return store


# ── DemandTemplate ─────────────────────────────────────────────────────────────

@router.get(
    "/stores/{store_id}/demand",
    response_model=DemandTemplateResponse,
)
async def get_demand(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)

    result = await db.execute(
        select(DemandTemplate).where(DemandTemplate.store_id == store_id)
    )
    demand = result.scalar_one_or_none()
    if not demand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demand not set for this store")
    return demand


@router.put(
    "/stores/{store_id}/demand",
    response_model=DemandTemplateResponse,
)
async def set_demand(
    store_id: uuid.UUID,
    body: DemandTemplateSet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)
    await assert_permission(current_user, "store.demand.edit", db)

    result = await db.execute(
        select(DemandTemplate).where(DemandTemplate.store_id == store_id)
    )
    demand = result.scalar_one_or_none()

    if demand:
        demand.slots = body.slots
    else:
        demand = DemandTemplate(store_id=store_id, slots=body.slots)
        db.add(demand)

    await db.commit()
    await db.refresh(demand)
    return demand


# ── ScheduleDeadlineConfig ─────────────────────────────────────────────────────

@router.get(
    "/stores/{store_id}/schedule-deadline-config",
    response_model=ScheduleDeadlineConfigResponse,
)
async def get_deadline_config(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)

    result = await db.execute(
        select(ScheduleDeadlineConfig).where(ScheduleDeadlineConfig.store_id == store_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deadline config not set for this store")
    return config


@router.put(
    "/stores/{store_id}/schedule-deadline-config",
    response_model=ScheduleDeadlineConfigResponse,
)
async def set_deadline_config(
    store_id: uuid.UUID,
    body: ScheduleDeadlineConfigSet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)
    await assert_permission(current_user, "store.schedule.deadline.manage", db)

    result = await db.execute(
        select(ScheduleDeadlineConfig).where(ScheduleDeadlineConfig.store_id == store_id)
    )
    config = result.scalar_one_or_none()

    if config:
        config.days_before_week_start = body.days_before_week_start
        config.deadline_time = body.deadline_time
    else:
        config = ScheduleDeadlineConfig(
            store_id=store_id,
            days_before_week_start=body.days_before_week_start,
            deadline_time=body.deadline_time,
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)
    return config
