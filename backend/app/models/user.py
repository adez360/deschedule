from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UUID, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _default_nickname(context) -> str:
    return context.get_current_parameters()["name"]

if TYPE_CHECKING:
    from app.models.availability import Availability, AvailabilityTemplate, StorePreference
    from app.models.payroll import EmployeeContract
    from app.models.role_group import UserRoleGroup
    from app.models.skill import UserSkill


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255))
    # Public display name — real `name` is only shown to holders of employee.identity.view.
    nickname: Mapped[str] = mapped_column(String(255), default=_default_nickname)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Manager-only free-form note (org.employee.manage).
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Per-employee daily scheduling cap; NULL = system default (scheduler.DAILY_HOUR_MAX)
    daily_hour_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Home store — FT monthly salary is attributed only to this store in payroll reports.
    home_store_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id", ondelete="SET NULL"), nullable=True
    )
    # NULL while the account is invited-but-not-yet-onboarded (IDEA-12). The
    # employee sets it themselves via the /onboard token flow.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # One-time onboarding / password-reset token (IDEA-12). Non-null = a pending
    # invite link is outstanding; cleared once the employee finishes onboarding.
    invite_token: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), unique=True, index=True, nullable=True
    )
    invite_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    calendar_token: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), unique=True, nullable=False, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    role_group_assignments: Mapped[list[UserRoleGroup]] = relationship(
        "UserRoleGroup", back_populates="user"
    )
    availabilities: Mapped[list[Availability]] = relationship("Availability", back_populates="user")
    availability_template: Mapped[AvailabilityTemplate | None] = relationship(
        "AvailabilityTemplate", back_populates="user", uselist=False
    )
    preferences: Mapped[list[StorePreference]] = relationship("StorePreference", back_populates="user")
    contracts: Mapped[list[EmployeeContract]] = relationship("EmployeeContract", back_populates="user")
    skill_assignments: Mapped[list[UserSkill]] = relationship("UserSkill", back_populates="user")
