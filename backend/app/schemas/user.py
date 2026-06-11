import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, EmailStr, Field

if TYPE_CHECKING:
    from app.models.user import User


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    nickname: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)
    phone: str | None = Field(default=None, max_length=32)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    nickname: str | None = Field(default=None, min_length=1, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=1024)
    note: str | None = Field(default=None, max_length=2000)
    hire_date: date | None = None
    phone: str | None = Field(default=None, max_length=32)
    home_store_id: uuid.UUID | None = Field(default=None)


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
    email: EmailStr
    phone: str | None
    home_store_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


def serialize_user(user: "User", viewer_perms: set[str], viewer_id: uuid.UUID) -> UserResponse:
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
        email=user.email,
        phone=user.phone,
        home_store_id=user.home_store_id,
        is_active=user.is_active,
        created_at=user.created_at,
    )
