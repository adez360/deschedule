from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UUID, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.role_group import RoleGroup
    from app.models.skill import Skill
    from app.models.store import Store


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    # use_alter avoids circular FK deadlock with users table at DDL time
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", use_alter=True, name="fk_organizations_owner_user_id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    stores: Mapped[list[Store]] = relationship("Store", back_populates="organization")
    role_groups: Mapped[list[RoleGroup]] = relationship("RoleGroup", back_populates="organization")
    skills: Mapped[list[Skill]] = relationship("Skill", back_populates="organization")
