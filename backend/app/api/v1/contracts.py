import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.payroll import EmployeeContract
from app.models.user import User
from app.schemas.contract import ContractResponse, ContractSet

router = APIRouter(tags=["contracts"])


async def _get_user_and_check_access(
    user_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> User:
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    return target


async def _get_active_contract(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> EmployeeContract | None:
    """Active = effective_until IS NULL (open-ended)."""
    result = await db.execute(
        select(EmployeeContract)
        .where(
            EmployeeContract.user_id == user_id,
            EmployeeContract.effective_until.is_(None),
        )
        .order_by(EmployeeContract.effective_from.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ── GET /users/{user_id}/contract ─────────────────────────────────────────────

@router.get(
    "/users/{user_id}/contract",
    response_model=ContractResponse,
)
async def get_active_contract(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current active contract for a user (org-level, not per-store)."""
    await _get_user_and_check_access(user_id, current_user, db)
    await assert_permission(current_user, "employee.payroll.view", db)

    contract = await _get_active_contract(user_id, db)
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active contract found for this user",
        )
    return contract


# ── PUT /users/{user_id}/contract ─────────────────────────────────────────────

@router.put(
    "/users/{user_id}/contract",
    response_model=ContractResponse,
)
async def upsert_contract(
    user_id: uuid.UUID,
    body: ContractSet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create or replace the active contract for a user.

    If an existing active contract exists:
    - Same effective_from: update in-place (rate/salary change, not a new period).
    - Different effective_from: close the old one (effective_until = new.effective_from − 1)
      and insert a new record to preserve payroll history.
    """
    await _get_user_and_check_access(user_id, current_user, db)
    await assert_permission(current_user, "employee.contract.edit", db)

    existing = await _get_active_contract(user_id, db)

    if existing and existing.effective_from == body.effective_from:
        existing.contract_type = body.contract_type
        existing.monthly_salary = body.monthly_salary
        existing.hourly_rate = body.hourly_rate
        await db.commit()
        await db.refresh(existing)
        return existing

    if existing:
        close_date = body.effective_from - timedelta(days=1)
        if close_date < existing.effective_from:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="New effective_from cannot be earlier than the existing contract's start date",
            )
        existing.effective_until = close_date

    new_contract = EmployeeContract(
        user_id=user_id,
        contract_type=body.contract_type,
        monthly_salary=body.monthly_salary,
        hourly_rate=body.hourly_rate,
        effective_from=body.effective_from,
        effective_until=None,
    )
    db.add(new_contract)
    await db.commit()
    await db.refresh(new_contract)
    return new_contract


# ── GET /users/{user_id}/contracts ───────────────────────────────────────────

@router.get(
    "/users/{user_id}/contracts",
    response_model=list[ContractResponse],
)
async def list_user_contracts(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all contracts for a user (including expired) — for history."""
    await _get_user_and_check_access(user_id, current_user, db)
    await assert_permission(current_user, "employee.payroll.view", db)

    result = await db.execute(
        select(EmployeeContract)
        .where(EmployeeContract.user_id == user_id)
        .order_by(EmployeeContract.effective_from.desc())
    )
    return result.scalars().all()
