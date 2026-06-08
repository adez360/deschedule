"""
建立第一個管理員帳號。

用法（在 backend 容器內執行）：
    python scripts/seed_admin.py

或指定帳號資訊：
    ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=secret123 ADMIN_NAME=Admin ORG_NAME=MyOrg \
    python scripts/seed_admin.py
"""

import asyncio
import os
import sys
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# Allow running from repo root or scripts/ dir
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import settings
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.user import User

# ── Config ────────────────────────────────────────────────────────────────────

ADMIN_EMAIL    = os.getenv("ADMIN_EMAIL",    "admin@example.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin1234")
ADMIN_NAME     = os.getenv("ADMIN_NAME",     "系統管理員")
ORG_NAME       = os.getenv("ORG_NAME",       "我的組織")

# ── Main ──────────────────────────────────────────────────────────────────────

async def seed() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Check if email already taken
        existing = await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        if existing.scalar_one_or_none():
            print(f"[skip] 帳號 {ADMIN_EMAIL} 已存在，跳過。")
            return

        # 1. Create Organization (owner_user_id will be patched below)
        org_id = uuid.uuid4()
        org = Organization(id=org_id, name=ORG_NAME)
        session.add(org)
        await session.flush()

        # 2. Create User
        user_id = uuid.uuid4()
        user = User(
            id=user_id,
            organization_id=org_id,
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            hashed_password=hash_password(ADMIN_PASSWORD),
            is_active=True,
        )
        session.add(user)
        await session.flush()

        # 3. Patch org owner
        org.owner_user_id = user_id
        await session.flush()

        # 4. Create org-level system admin role group
        rg_id = uuid.uuid4()
        rg = RoleGroup(
            id=rg_id,
            organization_id=org_id,
            store_id=None,
            name="系統管理者",
            permissions=["system.all"],
        )
        session.add(rg)
        await session.flush()

        # 5. Assign role group to user
        session.add(UserRoleGroup(user_id=user_id, role_group_id=rg_id))

        await session.commit()

    print("✓ 建立成功！")
    print(f"  組織：{ORG_NAME}")
    print(f"  帳號：{ADMIN_EMAIL}")
    print(f"  密碼：{ADMIN_PASSWORD}")
    print(f"  身份：系統管理者（system.all）")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
