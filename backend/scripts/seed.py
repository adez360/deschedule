"""
Bootstrap script — run once to create initial org, store, role groups, and test users.

Usage:
    docker compose exec backend python scripts/seed.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — registers all models with Base.metadata
from app.core.config import settings
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.store import Store
from app.models.user import User


async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        # ── Organization ──────────────────────────────────────────────────────
        org = Organization(name="測試加盟主")
        db.add(org)
        await db.flush()

        # ── Admin user ────────────────────────────────────────────────────────
        admin = User(
            organization_id=org.id,
            name="系統管理員",
            email="admin@example.com",
            hashed_password=hash_password("admin1234"),
        )
        db.add(admin)
        await db.flush()

        org.owner_user_id = admin.id

        # ── System-level role group ───────────────────────────────────────────
        rg_system = RoleGroup(
            organization_id=org.id,
            name="系統管理者",
            permissions=["system.all"],
        )
        db.add(rg_system)

        # ── Org-level role group ──────────────────────────────────────────────
        rg_org = RoleGroup(
            organization_id=org.id,
            name="組織管理者",
            permissions=[
                "org.manage",
                "org.schedule.view_all",
                "org.schedule.arrange",
                "org.employee.manage",
                "employee.availability.edit",
                "employee.preference.edit",
                "employee.payroll.view",
                "employee.contract.edit",
            ],
        )
        db.add(rg_org)
        await db.flush()

        # Assign both roles to admin
        db.add(UserRoleGroup(user_id=admin.id, role_group_id=rg_system.id))
        db.add(UserRoleGroup(user_id=admin.id, role_group_id=rg_org.id))

        # ── Store ─────────────────────────────────────────────────────────────
        store = Store(
            organization_id=org.id,
            name="門市A",
            address="台北市信義區松仁路100號",
            timezone="Asia/Taipei",
        )
        db.add(store)
        await db.flush()

        # ── Store-level role groups ───────────────────────────────────────────
        rg_manager = RoleGroup(
            organization_id=org.id,
            store_id=store.id,
            name="店經理",
            permissions=[
                "store.schedule.view",
                "store.schedule.edit",
                "store.demand.edit",
                "store.schedule.deadline.manage",
            ],
        )
        rg_ft = RoleGroup(
            organization_id=org.id,
            store_id=store.id,
            name="全職員工",
            permissions=[
                "self.schedule.view",
                "self.availability.edit",
                "self.preference.edit",
                "self.profile.edit",
            ],
        )
        db.add(rg_manager)
        db.add(rg_ft)
        await db.flush()

        # ── Test employee ─────────────────────────────────────────────────────
        employee = User(
            organization_id=org.id,
            name="張小明",
            email="employee@example.com",
            hashed_password=hash_password("emp12345"),
        )
        db.add(employee)
        await db.flush()

        db.add(UserRoleGroup(user_id=employee.id, role_group_id=rg_ft.id))

        await db.commit()

    await engine.dispose()

    print("\n" + "=" * 50)
    print("Seed data created successfully!")
    print("=" * 50)
    print(f"\n  Org      : 測試加盟主  ({org.id})")
    print(f"  Store    : 門市A       ({store.id})")
    print()
    print("  Admin credentials:")
    print("    email   : admin@example.com")
    print("    password: admin1234")
    print()
    print("  Employee credentials:")
    print("    email   : employee@example.com")
    print("    password: emp12345")
    print()
    print("  Role groups:")
    print(f"    系統管理者 : {rg_system.id}")
    print(f"    組織管理者 : {rg_org.id}")
    print(f"    店經理     : {rg_manager.id}")
    print(f"    全職員工   : {rg_ft.id}")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    asyncio.run(seed())
