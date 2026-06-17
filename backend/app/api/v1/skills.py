import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.skill import Skill, StoreSkillDemand, UserSkill
from app.models.store import Store
from app.models.user import User
from app.schemas.skill import (
    SkillCreate,
    SkillResponse,
    SkillUpdate,
    StoreSkillDemandResponse,
    StoreSkillDemandSet,
    UserSkillResponse,
)

router = APIRouter(tags=["skills"])


async def _get_store_and_check_access(store_id: uuid.UUID, current_user: User, db: AsyncSession) -> Store:
    store = await db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    await assert_org_access(current_user, store.organization_id, db)
    return store


# ── Skill CRUD (org-level) ─────────────────────────────────────────────────────

@router.get("/organizations/{org_id}/skills", response_model=list[SkillResponse])
async def list_skills(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    result = await db.execute(
        select(Skill).where(Skill.organization_id == org_id).order_by(Skill.name)
    )
    return result.scalars().all()


@router.post(
    "/organizations/{org_id}/skills",
    response_model=SkillResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_skill(
    org_id: uuid.UUID,
    body: SkillCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)

    existing = await db.execute(
        select(Skill).where(Skill.organization_id == org_id, Skill.name == body.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Skill name already exists")

    skill = Skill(organization_id=org_id, name=body.name)
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    return skill


@router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    await assert_org_access(current_user, skill.organization_id, db)
    await assert_permission(current_user, "org.manage", db)

    skill.name = body.name
    await db.commit()
    await db.refresh(skill)
    return skill


@router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    await assert_org_access(current_user, skill.organization_id, db)
    await assert_permission(current_user, "org.manage", db)

    await db.delete(skill)
    await db.commit()


# ── User skill assignment ──────────────────────────────────────────────────────

@router.get("/users/{user_id}/skills", response_model=list[UserSkillResponse])
async def list_user_skills(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)

    result = await db.execute(
        select(UserSkill)
        .options(selectinload(UserSkill.skill))
        .where(UserSkill.user_id == user_id)
    )
    return result.scalars().all()


@router.post(
    "/users/{user_id}/skills/{skill_id}",
    response_model=UserSkillResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_skill(
    user_id: uuid.UUID,
    skill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.employee.manage", db)

    skill = await db.get(Skill, skill_id)
    if not skill or skill.organization_id != target.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found in this organization",
        )

    existing = await db.get(UserSkill, (user_id, skill_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already assigned")

    db.add(UserSkill(user_id=user_id, skill_id=skill_id))
    await db.commit()

    result = await db.execute(
        select(UserSkill)
        .options(selectinload(UserSkill.skill))
        .where(UserSkill.user_id == user_id, UserSkill.skill_id == skill_id)
    )
    return result.scalar_one()


@router.delete(
    "/users/{user_id}/skills/{skill_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_skill(
    user_id: uuid.UUID,
    skill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await assert_org_access(current_user, target.organization_id, db)
    await assert_permission(current_user, "org.employee.manage", db)

    assignment = await db.get(UserSkill, (user_id, skill_id))
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    await db.delete(assignment)
    await db.commit()


# ── StoreSkillDemand ───────────────────────────────────────────────────────────

@router.get(
    "/stores/{store_id}/skill-demand",
    response_model=list[StoreSkillDemandResponse],
)
async def list_skill_demand(
    store_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)

    result = await db.execute(
        select(StoreSkillDemand)
        .options(selectinload(StoreSkillDemand.skill))
        .where(StoreSkillDemand.store_id == store_id)
    )
    return result.scalars().all()


@router.put(
    "/stores/{store_id}/skill-demand",
    response_model=StoreSkillDemandResponse,
)
async def set_skill_demand(
    store_id: uuid.UUID,
    body: StoreSkillDemandSet,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    store = await _get_store_and_check_access(store_id, current_user, db)
    await assert_permission(current_user, "store.demand.edit", db)

    skill = await db.get(Skill, body.skill_id)
    if not skill or skill.organization_id != store.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found in this organization",
        )

    result = await db.execute(
        select(StoreSkillDemand).where(
            StoreSkillDemand.store_id == store_id,
            StoreSkillDemand.skill_id == body.skill_id,
        )
    )
    demand = result.scalar_one_or_none()

    if demand:
        demand.slots = body.slots
    else:
        demand = StoreSkillDemand(
            store_id=store_id, skill_id=body.skill_id, slots=body.slots
        )
        db.add(demand)

    await db.commit()
    await db.refresh(demand, attribute_names=["skill"])
    return demand


@router.delete(
    "/stores/{store_id}/skill-demand/{skill_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_skill_demand(
    store_id: uuid.UUID,
    skill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_and_check_access(store_id, current_user, db)
    await assert_permission(current_user, "store.demand.edit", db)

    result = await db.execute(
        select(StoreSkillDemand).where(
            StoreSkillDemand.store_id == store_id,
            StoreSkillDemand.skill_id == skill_id,
        )
    )
    demand = result.scalar_one_or_none()
    if not demand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill demand not found")

    await db.delete(demand)
    await db.commit()
