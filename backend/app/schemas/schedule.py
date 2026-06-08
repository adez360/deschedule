import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.schedule import ScheduleStatus


class GenerateScheduleRequest(BaseModel):
    week_start: date

    @field_validator("week_start")
    @classmethod
    def must_be_monday(cls, v: date) -> date:
        if v.weekday() != 0:
            raise ValueError("week_start must be a Monday")
        return v


class ScheduleStatusUpdate(BaseModel):
    status: ScheduleStatus


class ScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    store_id: uuid.UUID
    week_start: date
    status: ScheduleStatus
    generated_at: datetime
    published_at: datetime | None


class AssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_id: uuid.UUID
    user_id: uuid.UUID
    store_id: uuid.UUID
    day: int
    hour: int
    is_manual: bool
    created_at: datetime


class ScheduleWithAssignments(ScheduleResponse):
    assignments: list[AssignmentResponse] = []


class AssignmentCreate(BaseModel):
    user_id: uuid.UUID
    day: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)


class AssignmentUpdate(BaseModel):
    """Swap the employee in an existing slot."""
    user_id: uuid.UUID
