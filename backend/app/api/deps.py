import uuid

from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.user import User

bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_user_permissions(user_id: uuid.UUID, db: AsyncSession) -> set[str]:
    result = await db.execute(
        select(RoleGroup)
        .join(UserRoleGroup, UserRoleGroup.role_group_id == RoleGroup.id)
        .where(UserRoleGroup.user_id == user_id)
    )
    permissions: set[str] = set()
    for rg in result.scalars().all():
        permissions.update(rg.permissions or [])
    return permissions


async def assert_permission(user: User, permission: str, db: AsyncSession) -> None:
    perms = await get_user_permissions(user.id, db)
    if "system.all" not in perms and permission not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {permission}",
        )


async def assert_org_access(user: User, org_id: uuid.UUID, db: AsyncSession) -> None:
    """Allow if user belongs to the org, or holds system.all."""
    perms = await get_user_permissions(user.id, db)
    if "system.all" in perms:
        return
    if user.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def require_permission(permission: str):
    """Dependency factory — use for route-level permission guards."""
    async def _check(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        await assert_permission(current_user, permission, db)
        return current_user

    return _check
