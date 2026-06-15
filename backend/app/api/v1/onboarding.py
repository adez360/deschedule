"""Public (token-gated) employee onboarding — IDEA-12.

No authentication: an invited employee proves identity by holding the one-time
invite token from the link the manager sent them. They confirm basic profile
info and set their own password, which activates the account.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.schemas.onboarding import OnboardInfo, OnboardSubmit

router = APIRouter(prefix="/onboard", tags=["onboarding"])

_INVALID = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="邀請連結無效或已過期，請向管理者重新索取",
)


async def _resolve_token(token: uuid.UUID, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.invite_token == token))
    user = result.scalar_one_or_none()
    if not user or user.invite_expires_at is None:
        raise _INVALID
    expires = user.invite_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise _INVALID
    return user


@router.get("/{token}", response_model=OnboardInfo)
async def onboard_info(token: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user = await _resolve_token(token, db)
    org = await db.get(Organization, user.organization_id)
    return OnboardInfo(
        name=user.name,
        nickname=user.nickname,
        email=user.email,
        phone=user.phone,
        organization_name=org.name if org else "",
    )


@router.post("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def onboard_submit(
    token: uuid.UUID,
    body: OnboardSubmit,
    db: AsyncSession = Depends(get_db),
):
    user = await _resolve_token(token, db)

    user.hashed_password = hash_password(body.password)
    if body.name is not None:
        user.name = body.name
    if body.nickname is not None:
        user.nickname = body.nickname
    if body.phone is not None:
        user.phone = body.phone
    # Consume the one-time token and ensure the account is enabled.
    user.invite_token = None
    user.invite_expires_at = None
    user.is_active = True
    await db.commit()
