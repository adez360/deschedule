import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import assert_org_access, assert_permission, get_current_user, get_user_permissions
from app.core.database import get_db
from app.models.organization import Organization
from app.models.role_group import UserRoleGroup
from app.models.store import Store
from app.models.user import User
from app.schemas.organization import OrganizationCreate, OrganizationResponse, OrganizationUpdate
from app.schemas.store import StoreCreate, StoreResponse
from app.schemas.user import InviteResponse, RoleGroupBrief, UserCreate, UserResponse, serialize_user

router = APIRouter(prefix="/organizations", tags=["organizations"])

# Onboarding invite links are valid for one week (IDEA-12 D1).
INVITE_TTL_DAYS = 7


@router.get("", response_model=list[OrganizationResponse])
async def list_organizations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """System admins only."""
    await assert_permission(current_user, "system.all", db)
    result = await db.execute(select(Organization).order_by(Organization.created_at))
    return result.scalars().all()


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """System admins only."""
    await assert_permission(current_user, "system.all", db)
    org = Organization(name=body.name)
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: uuid.UUID,
    body: OrganizationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(org, field, value)
    await db.commit()
    await db.refresh(org)
    return org


# ── Nested store routes ────────────────────────────────────────────────────────

@router.get("/{org_id}/stores", response_model=list[StoreResponse])
async def list_stores(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    result = await db.execute(
        select(Store).where(Store.organization_id == org_id).order_by(Store.created_at)
    )
    return result.scalars().all()


@router.post(
    "/{org_id}/stores",
    response_model=StoreResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_store(
    org_id: uuid.UUID,
    body: StoreCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    store = Store(organization_id=org_id, **body.model_dump())
    db.add(store)
    await db.commit()
    await db.refresh(store)
    return store


# ── Nested user routes ─────────────────────────────────────────────────────────

@router.get("/{org_id}/users", response_model=list[UserResponse])
async def list_users(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)
    result = await db.execute(
        select(User)
        .where(User.organization_id == org_id)
        .options(
            selectinload(User.contracts),
            selectinload(User.role_group_assignments).selectinload(UserRoleGroup.role_group),
        )
        .order_by(User.name)
    )
    perms = await get_user_permissions(current_user.id, db)

    def active_contract_type(u: User) -> str | None:
        # Current contract = the open one (effective_until is None); fall back to
        # the most recent by effective_from. Mirrors the upsert close-and-open rule.
        contracts = sorted(u.contracts, key=lambda c: c.effective_from)
        if not contracts:
            return None
        open_ones = [c for c in contracts if c.effective_until is None]
        chosen = open_ones[-1] if open_ones else contracts[-1]
        return chosen.contract_type.value

    return [
        serialize_user(
            u, perms, current_user.id,
            contract_type=active_contract_type(u),
            role_groups=[
                RoleGroupBrief(id=a.role_group.id, name=a.role_group.name)
                for a in u.role_group_assignments
                if a.role_group is not None
            ],
        )
        for u in result.scalars().all()
    ]


@router.post("/{org_id}/users", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    org_id: uuid.UUID,
    body: UserCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an invited (pending) employee. No password is set — an invite
    token is issued instead; the employee onboards via /onboard (IDEA-12)."""
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)

    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    user = User(
        organization_id=org_id,
        name=body.name,
        nickname=body.nickname or body.name,
        email=body.email,
        phone=body.phone,
        hashed_password=None,
        invite_token=uuid.uuid4(),
        invite_expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    perms = await get_user_permissions(current_user.id, db)
    return InviteResponse(
        user=serialize_user(user, perms, current_user.id),
        invite_token=user.invite_token,
        invite_expires_at=user.invite_expires_at,
    )


@router.post("/{org_id}/users/{user_id}/resend-invite", response_model=InviteResponse)
async def resend_invite(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Issue a fresh onboarding token. Works for pending employees (re-invite)
    and for active ones (doubles as a simple password reset — IDEA-12 F)."""
    await assert_org_access(current_user, org_id, db)
    await assert_permission(current_user, "org.manage", db)

    user = await db.get(User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.invite_token = uuid.uuid4()
    user.invite_expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    await db.commit()
    await db.refresh(user)
    perms = await get_user_permissions(current_user.id, db)
    return InviteResponse(
        user=serialize_user(user, perms, current_user.id),
        invite_token=user.invite_token,
        invite_expires_at=user.invite_expires_at,
    )
