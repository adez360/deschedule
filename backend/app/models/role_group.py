from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UUID, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class RoleGroup(Base):
    """
    store_ids=[]      → org-level group (applies to all stores in the org)
    store_ids=[id...] → scoped to those specific stores only
    """
    __tablename__ = "role_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    store_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"
    )
    name: Mapped[str] = mapped_column(String(100))
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")

    organization: Mapped[Organization | None] = relationship("Organization", back_populates="role_groups")
    user_assignments: Mapped[list[UserRoleGroup]] = relationship("UserRoleGroup", back_populates="role_group")


class UserRoleGroup(Base):
    __tablename__ = "user_role_groups"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    role_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("role_groups.id"), primary_key=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship("User", back_populates="role_group_assignments")
    role_group: Mapped[RoleGroup] = relationship("RoleGroup", back_populates="user_assignments")
