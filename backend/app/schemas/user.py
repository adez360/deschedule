import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, EmailStr, Field

if TYPE_CHECKING:
    from app.models.user import User


class UserCreate(BaseModel):
    # No password — the employee sets it themselves via the /onboard invite
    # flow (IDEA-12). The manager only seeds identity + contact.
    name: str = Field(min_length=1, max_length=255)
    nickname: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    nickname: str | None = Field(default=None, min_length=1, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=1024)
    note: str | None = Field(default=None, max_length=2000)
    hire_date: date | None = None
    daily_hour_max: int | None = Field(default=None, ge=1, le=24)
    phone: str | None = Field(default=None, max_length=32)
    home_store_id: uuid.UUID | None = Field(default=None)


class RoleGroupBrief(BaseModel):
    id: uuid.UUID
    name: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    # `name` carries the viewer-appropriate display value (real name only with
    # employee.identity.view / system.all / self); the raw name is never leaked.
    name: str
    nickname: str
    avatar_url: str | None
    note: str | None  # manager-only (org.employee.manage); null for others
    hire_date: date | None
    daily_hour_max: int | None
    email: EmailStr
    phone: str | None
    home_store_id: uuid.UUID | None
    is_active: bool
    # True while invited but not yet onboarded (no password set) — IDEA-12.
    is_pending: bool = False
    created_at: datetime
    # Enriched (list view only): active contract type + assigned role groups.
    # Default None/[] keeps single-user endpoints lightweight.
    contract_type: str | None = None
    role_groups: list[RoleGroupBrief] = []


class InviteResponse(BaseModel):
    """Returned on create / resend-invite so the manager can hand the link to
    the employee (IDEA-12 A1 — copy link, no email yet)."""

    user: UserResponse
    invite_token: uuid.UUID
    invite_expires_at: datetime


def serialize_user(
    user: "User",
    viewer_perms: set[str],
    viewer_id: uuid.UUID,
    *,
    contract_type: str | None = None,
    role_groups: list[RoleGroupBrief] | None = None,
) -> UserResponse:
    is_admin = "system.all" in viewer_perms
    show_name = is_admin or user.id == viewer_id or "employee.identity.view" in viewer_perms
    show_note = is_admin or "org.employee.manage" in viewer_perms
    return UserResponse(
        id=user.id,
        organization_id=user.organization_id,
        name=user.name if show_name else user.nickname,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        note=user.note if show_note else None,
        hire_date=user.hire_date,
        daily_hour_max=user.daily_hour_max,
        email=user.email,
        phone=user.phone,
        home_store_id=user.home_store_id,
        is_active=user.is_active,
        is_pending=user.hashed_password is None,
        created_at=user.created_at,
        contract_type=contract_type,
        role_groups=role_groups or [],
    )
