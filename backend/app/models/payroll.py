from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, UUID, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.store import Store
    from app.models.user import User


class ContractType(str, enum.Enum):
    FT = "FT"
    PT = "PT"
    CUSTOM = "custom"


class EmployeeContract(Base):
    """Active contract for an employee (org-level, not per-store). Multiple contracts may exist over time."""
    __tablename__ = "employee_contracts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    contract_type: Mapped[ContractType] = mapped_column(SAEnum(ContractType), nullable=False)
    monthly_salary: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)  # FT only
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)  # PT only
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[date | None] = mapped_column(Date, nullable=True)  # null = still active
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship("User", back_populates="contracts")


class PayrollReport(Base):
    """
    Generated when a Schedule is archived (or triggered manually).
    Rate/salary snapshots are frozen at calculation time so historical reports are immutable.
    Only generated for FT (monthly_salary) and PT (hourly_rate) contracts — CUSTOM contracts
    produce no report since they carry no pay terms.
    """
    __tablename__ = "payroll_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    total_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    contract_type: Mapped[ContractType] = mapped_column(SAEnum(ContractType), nullable=False)
    monthly_salary_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    hourly_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    gross_pay: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="TWD")
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    user: Mapped[User] = relationship("User")
    store: Mapped[Store] = relationship("Store", back_populates="payroll_reports")


class PayrollAdjustment(Base):
    """
    Manual pay adjustment line item for an employee in a given month (其他項目).
    Examples: overtime (+), transport (+), custom deductions (-).
    Amount is signed; sums into the employee's monthly grand total alongside base pay.
    Scoped per (user, year, month) — not per store — matching the personal monthly report.
    """
    __tablename__ = "payroll_adjustments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)  # signed (+/-)
    currency: Mapped[str] = mapped_column(String(3), default="TWD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship("User")
