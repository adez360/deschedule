from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Integer, UniqueConstraint, UUID, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.store import Store
    from app.models.user import User


class ScheduleStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Schedule(Base):
    """Weekly schedule for one store. Status flow: draft → published → archived."""
    __tablename__ = "schedules"
    __table_args__ = (UniqueConstraint("store_id", "week_start", name="uq_schedule_store_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False, index=True
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[ScheduleStatus] = mapped_column(
        SAEnum(ScheduleStatus), nullable=False, default=ScheduleStatus.DRAFT
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    store: Mapped[Store] = relationship("Store", back_populates="schedules")
    assignments: Mapped[list[Assignment]] = relationship("Assignment", back_populates="schedule")


class Assignment(Base):
    """Single hour slot assigned to one employee in a schedule."""
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("schedule_id", "user_id", "day", "hour", name="uq_assignment_slot"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedules.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False
    )
    day: Mapped[int] = mapped_column(Integer, nullable=False)   # 0=Monday … 6=Sunday
    hour: Mapped[int] = mapped_column(Integer, nullable=False)  # 0–23
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    schedule: Mapped[Schedule] = relationship("Schedule", back_populates="assignments")
    user: Mapped[User] = relationship("User")
