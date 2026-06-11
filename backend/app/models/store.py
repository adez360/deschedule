from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UUID, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.availability import StorePreference
    from app.models.demand import DemandTemplate, ScheduleDeadlineConfig
    from app.models.organization import Organization
    from app.models.payroll import PayrollReport
    from app.models.schedule import Schedule
    from app.models.skill import StoreSkillDemand


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Taipei")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    organization: Mapped[Organization] = relationship("Organization", back_populates="stores")
    schedules: Mapped[list[Schedule]] = relationship("Schedule", back_populates="store")
    demand_templates: Mapped[list[DemandTemplate]] = relationship("DemandTemplate", back_populates="store")
    deadline_config: Mapped[ScheduleDeadlineConfig | None] = relationship(
        "ScheduleDeadlineConfig", back_populates="store", uselist=False
    )
    preferences: Mapped[list[StorePreference]] = relationship("StorePreference", back_populates="store")
    payroll_reports: Mapped[list[PayrollReport]] = relationship("PayrollReport", back_populates="store")
    skill_demands: Mapped[list[StoreSkillDemand]] = relationship("StoreSkillDemand", back_populates="store")
