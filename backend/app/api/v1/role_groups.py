import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.store import Store
from app.models.user import User
from app.schemas.role_group import (
    RoleGroupCreate,
    RoleGroupResponse,
    RoleGroupUpdate,
    UserRoleGroupResponse,
)

router = APIRouter(tags=["role-groups"])


# ── RoleGroup CRUD ─────────────────────────────────────────────────────────────

@router.get("/organizations/{org_id}/role-groups", response_model=list[RoleGroupResponse])
async def list_role_groups(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    result = await db.execute(
        select(RoleGroup)
        .where(RoleGroup.organization_id == org_id)
        .order_by(RoleGroup.name)
    )
    return result.scalars().all()


@router.post(
    "/organizations/{org_id}/role-groups",
    response_model=RoleGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_role_group(
    org_id: uuid.UUID,
    body: RoleGroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)

    for store_id in body.store_ids:
        store = await db.get(Store, store_id)
        if not store or store.organization_id != org_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Store {store_id} not found in this organization",
            )

    rg = RoleGroup(organization_id=org_id, **body.model_dump())
    db.add(rg)
    await db.commit()
    await db.refresh(rg)
    return rg


@router.get("/role-groups/{role_group_id}", response_model=RoleGroupResponse)
async def get_role_group(
    role_group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rg = await db.get(RoleGroup, role_group_id)
    if not rg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role group not found")
    if rg.organization_id:
        await assert_org_access(current_user, rg.organization_id, db)
    return rg


@router.patch("/role-groups/{role_group_id}", response_model=RoleGroupResponse)
async def update_role_group(
    role_group_id: uuid.UUID,
    body: RoleGroupUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rg = await db.get(RoleGroup, role_group_id)
    if not rg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role group not found")
    if rg.organization_id:
        await assert_org_access(current_user, rg.organization_id, db)
    await assert_permission(current_user, "org.manage", db)

    if body.store_ids is not None:
        for store_id in body.store_ids:
            store = await db.get(Store, store_id)
            if not store or store.organization_id != rg.organization_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Store {store_id} not found in this organization",
                )

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rg, field, value)
    await db.commit()
    await db.refresh(rg)
    return rg


@router.delete("/role-groups/{role_group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role_group(
    role_group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rg = await db.get(RoleGroup, role_group_id)
    if not rg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role group not found")
    if rg.organization_id:
        await assert_org_access(current_user, rg.organization_id, db)
    await assert_permission(current_user, "org.manage", db)
    await db.delete(rg)
    await db.commit()


# ── User ↔ RoleGroup assignment ────────────────────────────────────────────────

@router.get("/users/{user_id}/role-groups", response_model=list[UserRoleGroupResponse])
async def list_user_role_groups(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)

    result = await db.execute(
        select(UserRoleGroup)
        .options(selectinload(UserRoleGroup.role_group))
        .where(UserRoleGroup.user_id == user_id)
    )
    return result.scalars().all()


@router.post(
    "/users/{user_id}/role-groups/{role_group_id}",
    response_model=UserRoleGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_role_group(
    user_id: uuid.UUID,
    role_group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.manage", db)

    rg = await db.get(RoleGroup, role_group_id)
    if not rg or rg.organization_id != target.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role group not found in this organization",
        )

    existing = await db.get(UserRoleGroup, (user_id, role_group_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already assigned")

    db.add(UserRoleGroup(user_id=user_id, role_group_id=role_group_id))
    await db.commit()

    result = await db.execute(
        select(UserRoleGroup)
        .options(selectinload(UserRoleGroup.role_group))
        .where(
            UserRoleGroup.user_id == user_id,
            UserRoleGroup.role_group_id == role_group_id,
        )
    )
    return result.scalar_one()


@router.delete(
    "/users/{user_id}/role-groups/{role_group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_role_group(
    user_id: uuid.UUID,
    role_group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.manage", db)

    assignment = await db.get(UserRoleGroup, (user_id, role_group_id))
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    await db.delete(assignment)
    await db.commit()
