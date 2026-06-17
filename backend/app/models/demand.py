from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, Time, UUID, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.store import Store


class DemandTemplate(Base):
    """Standing required headcount per slot for a store (IDEA-15). One row per store —
    no week dimension; the same demand applies to every week.
    slots: int[7][24] — index 0 = Monday 00:00."""
    __tablename__ = "demand_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False, unique=True, index=True
    )
    slots: Mapped[Any] = mapped_column(JSONB, nullable=False)  # int[7][24]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    store: Mapped[Store] = relationship("Store", back_populates="demand_templates")


class ScheduleDeadlineConfig(Base):
    """Per-store config for when employees must finish filling their availability."""
    __tablename__ = "schedule_deadline_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), unique=True, nullable=False
    )
    # Days before the target week's Monday that the deadline falls on (default 2 = Saturday)
    days_before_week_start: Mapped[int] = mapped_column(Integer, default=2)
    deadline_time: Mapped[time] = mapped_column(Time, default=time(23, 59))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    store: Mapped[Store] = relationship("Store", back_populates="deadline_config")
