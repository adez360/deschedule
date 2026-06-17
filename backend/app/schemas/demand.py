import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DemandTemplateSet(BaseModel):
    slots: list[list[int]]  # [7][24] — required headcount per slot, each >= 0

    @field_validator("slots")
    @classmethod
    def validate_shape(cls, v: list[list[int]]) -> list[list[int]]:
        if len(v) != 7:
            raise ValueError("slots must have exactly 7 days")
        for i, day in enumerate(v):
            if len(day) != 24:
                raise ValueError(f"day {i} must have exactly 24 hours")
            for h, val in enumerate(day):
                if val < 0:
                    raise ValueError(f"day {i} hour {h}: demand cannot be negative")
        return v


class DemandTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    store_id: uuid.UUID
    slots: list[list[int]]
    updated_at: datetime


class ScheduleDeadlineConfigSet(BaseModel):
    days_before_week_start: int = Field(default=2, ge=1, le=7)
    deadline_time: time = Field(default=time(23, 59))


class ScheduleDeadlineConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    store_id: uuid.UUID
    days_before_week_start: int
    deadline_time: time
    updated_at: datetime
