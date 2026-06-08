from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, UUID, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.store import Store
    from app.models.user import User


class Skill(Base):
    """Org-defined ability tag (e.g. 日結帳 / 補貨 / 關店 / 開店)."""
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_skill_org_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    organization: Mapped[Organization] = relationship("Organization", back_populates="skills")
    user_assignments: Mapped[list[UserSkill]] = relationship("UserSkill", back_populates="skill")
    store_demands: Mapped[list[StoreSkillDemand]] = relationship("StoreSkillDemand", back_populates="skill")


class UserSkill(Base):
    __tablename__ = "user_skills"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("skills.id"), primary_key=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship("User", back_populates="skill_assignments")
    skill: Mapped[Skill] = relationship("Skill", back_populates="user_assignments")


class StoreSkillDemand(Base):
    """Required headcount with a given skill per slot. slots: int[7][24] — index 0 = Monday 00:00."""
    __tablename__ = "store_skill_demands"
    __table_args__ = (
        UniqueConstraint("store_id", "week_start", "skill_id", name="uq_skill_demand_store_week_skill"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False, index=True
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    skill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("skills.id"), nullable=False
    )
    slots: Mapped[Any] = mapped_column(JSONB, nullable=False)  # bool[7][24]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    store: Mapped[Store] = relationship("Store", back_populates="skill_demands")
    skill: Mapped[Skill] = relationship("Skill", back_populates="store_demands")
