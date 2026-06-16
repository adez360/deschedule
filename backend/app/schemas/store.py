import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    timezone: str = Field(default="Asia/Taipei", max_length=64)
    cross_group: str | None = Field(default=None, max_length=64)
    manager_user_id: uuid.UUID | None = Field(default=None)
    color: str | None = Field(default=None, max_length=9)


class StoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    timezone: str | None = Field(default=None, max_length=64)
    cross_group: str | None = Field(default=None, max_length=64)
    manager_user_id: uuid.UUID | None = Field(default=None)
    color: str | None = Field(default=None, max_length=9)


class StoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    address: str | None
    timezone: str
    cross_group: str | None
    manager_user_id: uuid.UUID | None
    color: str | None
    created_at: datetime
