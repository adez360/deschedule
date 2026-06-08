import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.permissions import ALL_PERMISSIONS


class RoleGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    store_ids: list[uuid.UUID] = []
    permissions: list[str] = []

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str]) -> list[str]:
        invalid = set(v) - ALL_PERMISSIONS
        if invalid:
            raise ValueError(f"Unknown permissions: {sorted(invalid)}")
        return v


class RoleGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    store_ids: list[uuid.UUID] | None = None
    permissions: list[str] | None = None

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        invalid = set(v) - ALL_PERMISSIONS
        if invalid:
            raise ValueError(f"Unknown permissions: {sorted(invalid)}")
        return v


class RoleGroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None
    store_ids: list[uuid.UUID]
    name: str
    permissions: list[str]


class UserRoleGroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    role_group_id: uuid.UUID
    granted_at: datetime
    role_group: RoleGroupResponse
