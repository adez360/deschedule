import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, field_validator


class AvailabilitySet(BaseModel):
    slots: list[list[bool]]          # [7][24] — index 0 = Monday 00:00
    is_default_template: bool = False

    @field_validator("slots")
    @classmethod
    def validate_shape(cls, v: list[list[bool]]) -> list[list[bool]]:
        if len(v) != 7:
            raise ValueError("slots must have exactly 7 days")
        for i, day in enumerate(v):
            if len(day) != 24:
                raise ValueError(f"day {i} must have exactly 24 hours")
        return v


class AvailabilityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    week_start: date
    slots: list[list[bool]]
    is_default_template: bool
    locked: bool
    updated_at: datetime
