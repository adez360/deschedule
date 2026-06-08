from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UUID, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.availability import Availability, StorePreference
    from app.models.payroll import EmployeeContract
    from app.models.role_group import UserRoleGroup


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    calendar_token: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), unique=True, nullable=False, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    role_group_assignments: Mapped[list[UserRoleGroup]] = relationship(
        "UserRoleGroup", back_populates="user"
    )
    availabilities: Mapped[list[Availability]] = relationship("Availability", back_populates="user")
    preferences: Mapped[list[StorePreference]] = relationship("StorePreference", back_populates="user")
    contracts: Mapped[list[EmployeeContract]] = relationship("EmployeeContract", back_populates="user")
