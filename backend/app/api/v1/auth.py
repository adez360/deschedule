import uuid

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models.role_group import UserRoleGroup
from app.models.user import User
from app.schemas.auth import LoginRequest, RoleGroupSummary, TokenResponse, UserSummary

router = APIRouter(prefix="/auth", tags=["auth"])

_REFRESH_COOKIE = "refresh_token"
_REFRESH_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=False,   # TODO: set True behind HTTPS in production
        samesite="lax",
        max_age=_REFRESH_MAX_AGE,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .options(selectinload(User.role_group_assignments).selectinload(UserRoleGroup.role_group))
        .where(User.email == body.email)
    )
    user = result.scalar_one_or_none()

    # Pending (invited, not yet onboarded) accounts have no password set.
    if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    role_groups = [
        RoleGroupSummary(
            id=str(a.role_group.id),
            name=a.role_group.name,
            store_ids=[str(sid) for sid in (a.role_group.store_ids or [])],
            permissions=a.role_group.permissions,
        )
        for a in user.role_group_assignments
    ]

    _set_refresh_cookie(response, create_refresh_token(str(user.id)))
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        user=UserSummary(
            id=str(user.id),
            email=user.email,
            name=user.name,
            organization_id=str(user.organization_id),
            role_groups=role_groups,
            calendar_token=str(user.calendar_token),
        ),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(_REFRESH_COOKIE)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=_REFRESH_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing refresh token"
    )
    if not refresh_token:
        raise credentials_error

    try:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise credentials_error

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise credentials_error

    _set_refresh_cookie(response, create_refresh_token(str(user.id)))
    return TokenResponse(access_token=create_access_token(str(user.id)))
