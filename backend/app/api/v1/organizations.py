import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import assert_org_access, assert_permission, get_current_user
from app.core.database import get_db
from app.models.organization import Organization
from app.models.store import Store
from app.models.user import User
from app.core.security import hash_password
from app.schemas.organization import OrganizationCreate, OrganizationResponse, OrganizationUpdate
from app.schemas.store import StoreCreate, StoreResponse
from app.schemas.user import UserCreate, UserResponse

router = APIRouter(prefix="/organizations", tags=["organizations"])


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
        select(User).where(User.organization_id == org_id).order_by(User.name)
    )
    return result.scalars().all()


@router.post("/{org_id}/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    org_id: uuid.UUID,
    body: UserCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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
        email=body.email,
        phone=body.phone,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
