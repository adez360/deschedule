import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.availability import StorePreference
from app.models.store import Store
from app.models.user import User
from app.schemas.preference import StorePreferenceResponse, StorePreferenceUpdate

router = APIRouter(tags=["preferences"])


async def _upsert_preferences(
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    body: StorePreferenceUpdate,
    db: AsyncSession,
) -> list[StorePreference]:
    store_ids = [p.store_id for p in body.preferences]

    # Validate all stores belong to the org in one query
    result = await db.execute(
        select(Store).where(
            Store.id.in_(store_ids),
            Store.organization_id == org_id,
        )
    )
    valid_ids = {s.id for s in result.scalars().all()}
    invalid = set(store_ids) - valid_ids
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stores not found in organization: {[str(i) for i in invalid]}",
        )

    # Load existing preferences
    existing_result = await db.execute(
        select(StorePreference).where(StorePreference.user_id == user_id)
    )
    existing = {p.store_id: p for p in existing_result.scalars().all()}

    # Delete preferences not in the new list
    update_ids = set(store_ids)
    for store_id, pref in existing.items():
        if store_id not in update_ids:
            await db.delete(pref)

    # Upsert
    for item in body.preferences:
        if item.store_id in existing:
            existing[item.store_id].weight = item.weight
        else:
            db.add(StorePreference(user_id=user_id, store_id=item.store_id, weight=item.weight))

    await db.commit()

    result = await db.execute(
        select(StorePreference).where(StorePreference.user_id == user_id)
    )
    return result.scalars().all()


# ── /users/me/preferences ─────────────────────────────────────────────────────

@router.get("/users/me/preferences", response_model=list[StorePreferenceResponse])
async def get_my_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StorePreference).where(StorePreference.user_id == current_user.id)
    )
    return result.scalars().all()


@router.put("/users/me/preferences", response_model=list[StorePreferenceResponse])
async def update_my_preferences(
    body: StorePreferenceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_permission(current_user, "self.preference.edit", db)
    return await _upsert_preferences(
        current_user.id, current_user.organization_id, body, db
    )


# ── /users/{user_id}/preferences  (admin) ─────────────────────────────────────

@router.get("/users/{user_id}/preferences", response_model=list[StorePreferenceResponse])
async def get_user_preferences(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.preference.edit", db)

    result = await db.execute(
        select(StorePreference).where(StorePreference.user_id == user_id)
    )
    return result.scalars().all()


@router.put("/users/{user_id}/preferences", response_model=list[StorePreferenceResponse])
async def update_user_preferences(
    user_id: uuid.UUID,
    body: StorePreferenceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "employee.preference.edit", db)
    return await _upsert_preferences(user_id, target.organization_id, body, db)
