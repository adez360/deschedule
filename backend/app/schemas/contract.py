import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.payroll import ContractType


class ContractSet(BaseModel):
    contract_type: ContractType
    monthly_salary: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=10)
    hourly_rate: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=10)
    effective_from: date

    @model_validator(mode="after")
    def fields_match_contract_type(self) -> "ContractSet":
        if self.contract_type == ContractType.FT:
            if self.monthly_salary is None:
                raise ValueError("FT contracts require monthly_salary")
            self.hourly_rate = None
        elif self.contract_type == ContractType.PT:
            if self.hourly_rate is None:
                raise ValueError("PT contracts require hourly_rate")
            self.monthly_salary = None
        else:  # CUSTOM — no pay terms
            self.monthly_salary = None
            self.hourly_rate = None
        return self


class ContractResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    contract_type: ContractType
    monthly_salary: Decimal | None
    hourly_rate: Decimal | None
    effective_from: date
    effective_until: date | None
    created_at: datetime
