import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SkillUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SkillResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    created_at: datetime


class UserSkillResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    skill_id: uuid.UUID
    granted_at: datetime
    skill: SkillResponse


def _validate_slots_shape(v: list[list[bool]]) -> list[list[bool]]:
    if len(v) != 7:
        raise ValueError("slots must have exactly 7 days")
    for i, day in enumerate(v):
        if len(day) != 24:
            raise ValueError(f"day {i} must have exactly 24 hours")
    return v


class StoreSkillDemandSet(BaseModel):
    skill_id: uuid.UUID
    slots: list[list[bool]]  # [7][24] — whether this skill is needed in each slot

    @field_validator("slots")
    @classmethod
    def validate_shape(cls, v: list[list[bool]]) -> list[list[bool]]:
        return _validate_slots_shape(v)


class StoreSkillDemandResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    store_id: uuid.UUID
    week_start: date
    skill_id: uuid.UUID
    slots: list[list[bool]]
    updated_at: datetime
    skill: SkillResponse
