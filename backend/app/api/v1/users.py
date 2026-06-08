import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user, get_user_permissions
from app.core.database import get_db
from app.models.user import User
from app.schemas.user import UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_permission(current_user, "self.profile.edit", db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Allow self-access, otherwise require org.manage within the same org
    if target.id != current_user.id:
        await assert_org_access(current_user, target.organization_id, db)
        await assert_permission(current_user, "org.manage", db)

    return target


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.id == current_user.id:
        await assert_permission(current_user, "self.profile.edit", db)
    else:
        await assert_org_access(current_user, target.organization_id, db)
        await assert_permission(current_user, "org.manage", db)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(target, field, value)
    await db.commit()
    await db.refresh(target)
    return target


@router.patch("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.employee.manage", db)
    target.is_active = False
    await db.commit()
    await db.refresh(target)
    return target
