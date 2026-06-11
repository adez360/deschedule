import calendar
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user, get_user_permissions
from app.core.database import get_db
from app.models.payroll import PayrollAdjustment, PayrollReport
from app.models.schedule import Schedule, ScheduleStatus
from app.models.store import Store
from app.models.user import User
from app.schemas.payroll import (
    PayrollAdjustmentCreate,
    PayrollAdjustmentResponse,
    PayrollAdjustmentUpdate,
    PayrollGenerateRequest,
    PayrollReportResponse,
)
from app.services.payroll import create_payroll_reports

router = APIRouter(tags=["payroll"])


def _month_range(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return first, last


async def _query_reports(
    year: int,
    month: int,
    db: AsyncSession,
    *,
    store_ids: list[uuid.UUID] | None = None,
    user_id: uuid.UUID | None = None,
    viewer: User | None = None,
) -> list[PayrollReportResponse]:
    # name/nickname visibility gate (employee.identity.view); viewer=None → show real names (self view)
    show_identity = True
    viewer_id = None
    if viewer is not None:
        viewer_id = viewer.id
        perms = await get_user_permissions(viewer.id, db)
        show_identity = "system.all" in perms or "employee.identity.view" in perms
    first, last = _month_range(year, month)
    stmt = (
        select(PayrollReport)
        .options(selectinload(PayrollReport.user), selectinload(PayrollReport.store))
        .where(
            PayrollReport.week_start >= first,
            PayrollReport.week_start <= last,
        )
        .order_by(PayrollReport.user_id, PayrollReport.store_id, PayrollReport.week_start)
    )
    if store_ids is not None:
        stmt = stmt.where(PayrollReport.store_id.in_(store_ids))
    if user_id is not None:
        stmt = stmt.where(PayrollReport.user_id == user_id)

    result = await db.execute(stmt)
    return [
        PayrollReportResponse(
            id=r.id,
            user_id=r.user_id,
            user_name=r.user.name if (show_identity or r.user_id == viewer_id) else r.user.nickname,
            store_id=r.store_id,
            store_name=r.store.name,
            home_store_id=r.user.home_store_id,
            week_start=r.week_start,
            total_hours=r.total_hours,
            contract_type=r.contract_type,
            monthly_salary_snapshot=r.monthly_salary_snapshot,
            hourly_rate_snapshot=r.hourly_rate_snapshot,
            gross_pay=r.gross_pay,
            currency=r.currency,
            generated_at=r.generated_at,
            note=r.note,
        )
        for r in result.scalars().all()
    ]


# ── Management views (store / org) ────────────────────────────────────────────


@router.get("/organizations/{org_id}/payroll", response_model=list[PayrollReportResponse])
async def get_org_payroll(
    org_id: uuid.UUID,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "employee.payroll.view", db)
    stores_result = await db.execute(
        select(Store.id).where(Store.organization_id == org_id)
    )
    store_ids = list(stores_result.scalars().all())
    return await _query_reports(year, month, db, store_ids=store_ids, viewer=current_user)


@router.get("/stores/{store_id}/payroll", response_model=list[PayrollReportResponse])
async def get_store_payroll(
    store_id: uuid.UUID,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "employee.payroll.view", db)
    return await _query_reports(year, month, db, store_ids=[store_id], viewer=current_user)


# ── Personal views (self / specific employee) ─────────────────────────────────


@router.get("/users/me/payroll", response_model=list[PayrollReportResponse])
async def get_my_payroll(
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Any authenticated employee may view their own payroll report."""
    return await _query_reports(year, month, db, user_id=current_user.id)


@router.get("/users/{user_id}/payroll", response_model=list[PayrollReportResponse])
async def get_user_payroll(
    user_id: uuid.UUID,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """View a specific employee's report. Self is always allowed; otherwise requires payroll.view."""
    if user_id != current_user.id:
        target = await db.get(User, user_id)
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        await assert_org_access(current_user, target.organization_id, db)
        await assert_permission(current_user, "employee.payroll.view", db)
    return await _query_reports(year, month, db, user_id=user_id, viewer=current_user)


# ── Manual (re)generation ─────────────────────────────────────────────────────


@router.post("/stores/{store_id}/payroll/generate")
async def generate_store_payroll(
    store_id: uuid.UUID,
    body: PayrollGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "employee.payroll.view", db)

    first, last = _month_range(body.year, body.month)
    result = await db.execute(
        select(Schedule).where(
            Schedule.store_id == store_id,
            Schedule.week_start >= first,
            Schedule.week_start <= last,
            Schedule.status == ScheduleStatus.ARCHIVED,
        )
    )
    schedules = result.scalars().all()
    if not schedules:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No archived schedules found for the selected month. Archive the schedule first.",
        )

    for schedule in schedules:
        await create_payroll_reports(schedule, db)
    await db.commit()

    return {"generated": len(schedules), "weeks": [str(s.week_start) for s in schedules]}


# ── Pay adjustments (其他項目) ────────────────────────────────────────────────


async def _assert_can_edit_payroll(
    current_user: User, target_user_id: uuid.UUID, db: AsyncSession
) -> User:
    """Editing adjustments requires employee.payroll.view (managers only)."""
    target = await db.get(User, target_user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.payroll.view", db)
    return target


@router.get(
    "/users/{user_id}/payroll-adjustments",
    response_model=list[PayrollAdjustmentResponse],
)
async def list_adjustments(
    user_id: uuid.UUID,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Self may view own adjustments; otherwise requires payroll.view."""
    if user_id != current_user.id:
        target = await db.get(User, user_id)
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        await assert_org_access(current_user, target.organization_id, db)
        await assert_permission(current_user, "employee.payroll.view", db)

    result = await db.execute(
        select(PayrollAdjustment)
        .where(
            PayrollAdjustment.user_id == user_id,
            PayrollAdjustment.year == year,
            PayrollAdjustment.month == month,
        )
        .order_by(PayrollAdjustment.created_at)
    )
    return list(result.scalars().all())


@router.post(
    "/users/{user_id}/payroll-adjustments",
    response_model=PayrollAdjustmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_adjustment(
    user_id: uuid.UUID,
    body: PayrollAdjustmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _assert_can_edit_payroll(current_user, user_id, db)
    adj = PayrollAdjustment(
        user_id=user_id,
        year=body.year,
        month=body.month,
        label=body.label,
        amount=body.amount,
        currency=body.currency,
    )
    db.add(adj)
    await db.commit()
    await db.refresh(adj)
    return adj


@router.patch(
    "/payroll-adjustments/{adjustment_id}",
    response_model=PayrollAdjustmentResponse,
)
async def update_adjustment(
    adjustment_id: uuid.UUID,
    body: PayrollAdjustmentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    adj = await db.get(PayrollAdjustment, adjustment_id)
    if not adj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment not found")
    await _assert_can_edit_payroll(current_user, adj.user_id, db)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(adj, field, value)
    await db.commit()
    await db.refresh(adj)
    return adj


@router.delete(
    "/payroll-adjustments/{adjustment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_adjustment(
    adjustment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    adj = await db.get(PayrollAdjustment, adjustment_id)
    if not adj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment not found")
    await _assert_can_edit_payroll(current_user, adj.user_id, db)
    await db.delete(adj)
    await db.commit()
