import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user, get_user_permissions
from app.core.database import get_db
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import PasswordChangeRequest, UserResponse, UserUpdate, serialize_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    perms = await get_user_permissions(current_user.id, db)
    return serialize_user(current_user, perms, current_user.id)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_permission(current_user, "self.profile.edit", db)
    perms = await get_user_permissions(current_user.id, db)
    # exclude_unset → proper PATCH: only fields the client sent, so nullable
    # fields (daily_hour_max, home_store_id…) can be explicitly cleared to null
    data = body.model_dump(exclude_unset=True)
    # note is a manager-only field; ignore it on self-service updates
    if "system.all" not in perms and "org.employee.manage" not in perms:
        data.pop("note", None)
    for field, value in data.items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return serialize_user(current_user, perms, current_user.id)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(
    body: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Any authenticated, non-pending user may change their own password — no
    # extra permission bit (mirrors the "own data" openness of GET /users/me).
    if current_user.hashed_password is None:
        # Pending account (invite not yet completed) — must onboard first.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account has no password set; complete the invite flow first",
        )
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()


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

    perms = await get_user_permissions(current_user.id, db)
    return serialize_user(target, perms, current_user.id)


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

    # exclude_unset → only apply fields the client actually sent (proper PATCH),
    # so home_store_id can be set to a value or explicitly cleared to null.
    perms = await get_user_permissions(current_user.id, db)
    data = body.model_dump(exclude_unset=True)
    if "system.all" not in perms and "org.employee.manage" not in perms:
        data.pop("note", None)
    for field, value in data.items():
        setattr(target, field, value)
    await db.commit()
    await db.refresh(target)
    return serialize_user(target, perms, current_user.id)


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
    if target.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")
    target.is_active = False
    await db.commit()
    await db.refresh(target)
    perms = await get_user_permissions(current_user.id, db)
    return serialize_user(target, perms, current_user.id)


@router.patch("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-enable a previously deactivated employee (soft-delete reversal)."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.employee.manage", db)
    target.is_active = True
    await db.commit()
    await db.refresh(target)
    perms = await get_user_permissions(current_user.id, db)
    return serialize_user(target, perms, current_user.id)
