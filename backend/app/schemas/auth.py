from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RoleGroupSummary(BaseModel):
    id: str
    name: str
    store_ids: list[str]
    permissions: list[str]


class UserSummary(BaseModel):
    id: str
    email: str
    name: str
    organization_id: str
    role_groups: list[RoleGroupSummary]
    calendar_token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSummary
