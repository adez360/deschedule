from pydantic import BaseModel, EmailStr, Field


class OnboardInfo(BaseModel):
    """Public, token-gated preview shown on the /onboard page so the invited
    employee can confirm who the account belongs to before setting a password.
    Deliberately minimal — no ids, no permissions."""

    name: str
    nickname: str
    email: EmailStr
    phone: str | None
    organization_name: str


class OnboardSubmit(BaseModel):
    """Employee completes their own account: sets a password and confirms /
    fills basic profile (IDEA-12 E2)."""

    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    nickname: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
