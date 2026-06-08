import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StorePreferenceItem(BaseModel):
    store_id: uuid.UUID
    weight: float = Field(ge=0.0, le=1.0)


class StorePreferenceUpdate(BaseModel):
    preferences: list[StorePreferenceItem]

    @model_validator(mode="after")
    def weights_must_sum_to_one(self) -> "StorePreferenceUpdate":
        if not self.preferences:
            return self
        total = sum(p.weight for p in self.preferences)
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"All weights must sum to 1.0, got {total:.4f}")
        return self


class StorePreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    store_id: uuid.UUID
    weight: float
