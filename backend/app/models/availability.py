from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, UniqueConstraint, UUID, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.store import Store
    from app.models.user import User


class Availability(Base):
    """
    slots: bool[7][24] — index 0 = Monday 00:00.
    Employees can fill up to N weeks ahead; missing weeks auto-copy from the default template.
    """
    __tablename__ = "availabilities"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_availability_user_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)  # always a Monday
    slots: Mapped[Any] = mapped_column(JSONB, nullable=False)        # bool[7][24]
    is_default_template: Mapped[bool] = mapped_column(Boolean, default=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship("User", back_populates="availabilities")


class StorePreference(Base):
    """Employee's willingness to work at a given store (all weights for a user must sum to 1.0)."""
    __tablename__ = "store_preferences"
    __table_args__ = (UniqueConstraint("user_id", "store_id", name="uq_preference_user_store"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False
    )
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    user: Mapped[User] = relationship("User", back_populates="preferences")
    store: Mapped[Store] = relationship("Store", back_populates="preferences")
