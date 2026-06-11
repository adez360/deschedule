import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.payroll import ContractType


class PayrollReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    store_id: uuid.UUID
    store_name: str
    # The employee's home store — FT monthly salary is attributed only here.
    home_store_id: uuid.UUID | None
    week_start: date
    total_hours: Decimal
    contract_type: ContractType
    monthly_salary_snapshot: Decimal | None
    hourly_rate_snapshot: Decimal | None
    gross_pay: Decimal | None
    currency: str
    generated_at: datetime
    note: str | None


class PayrollGenerateRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


# ── Pay adjustments (其他項目) ────────────────────────────────────────────────


class PayrollAdjustmentResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    year: int
    month: int
    label: str
    amount: Decimal
    currency: str
    created_at: datetime


class PayrollAdjustmentCreate(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    label: str = Field(min_length=1, max_length=100)
    amount: Decimal
    currency: str = Field(default="TWD", min_length=3, max_length=3)


class PayrollAdjustmentUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    amount: Decimal | None = Field(default=None)
