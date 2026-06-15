import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.store import Store
from app.models.user import User
from app.schemas.store import StoreResponse, StoreUpdate

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("/{store_id}", response_model=StoreResponse)
async def get_store(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    return store


@router.patch("/{store_id}", response_model=StoreResponse)
async def update_store(
    store_id: uuid.UUID,
    body: StoreUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "org.manage", db)
    # exclude_unset (not exclude_none) so nullable fields can be explicitly cleared
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None and field not in ("address", "cross_group"):
            continue  # name/timezone are NOT NULL
        setattr(store, field, value)
    await db.commit()
    await db.refresh(store)
    return store


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_store(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    await assert_permission(current_user, "org.manage", db)
    await db.delete(store)
    await db.commit()
