"""
建立測試資料：員工、可用性、門市偏好、人力需求。
用法：
    docker compose exec backend python scripts/seed_test_data.py
"""
import asyncio
import os
import sys
import uuid
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import hash_password
from app.models.availability import Availability, StorePreference
from app.models.demand import DemandTemplate
from app.models.organization import Organization
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.store import Store
from app.models.user import User

STORE_NAME = os.getenv("STORE_NAME", "門市A")
WEEK_START = date(2026, 6, 1)  # Monday

EMPLOYEES = [
    {"name": "王小明", "email": "wang@example.com"},
    {"name": "李大華", "email": "li@example.com"},
    {"name": "陳美麗", "email": "chen@example.com"},
    {"name": "張志明", "email": "zhang@example.com"},
]

# slots[day][hour]: True = available. Day 0=Mon, hour 0=00:00
def make_slots(available_hours: list[tuple[int, int, int]]) -> list[list[bool]]:
    """available_hours: list of (day, start_hour, end_hour)"""
    slots = [[False] * 24 for _ in range(7)]
    for day, start, end in available_hours:
        for h in range(start, end):
            slots[day][h] = True
    return slots


EMPLOYEE_AVAILABILITY = [
    # 王小明: Mon-Fri 9-17
    make_slots([(d, 9, 17) for d in range(5)]),
    # 李大華: Tue-Sat 14-22
    make_slots([(d, 14, 22) for d in range(1, 6)]),
    # 陳美麗: Mon/Wed/Fri 12-20
    make_slots([(d, 12, 20) for d in [0, 2, 4]]),
    # 張志明: Mon-Thu 20-24 (overnight)
    make_slots([(d, 20, 24) for d in range(4)]),
]

# Demand: need 2 people 09-17, 1 person 17-22 on weekdays; 1 person on weekends
def make_demand() -> list[list[int]]:
    slots = [[0] * 24 for _ in range(7)]
    for day in range(7):
        if day < 5:  # weekday
            for h in range(9, 17): slots[day][h] = 2
            for h in range(17, 22): slots[day][h] = 1
        else:  # weekend
            for h in range(10, 20): slots[day][h] = 1
    return slots


async def seed() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Find store
        result = await session.execute(select(Store).where(Store.name == STORE_NAME))
        store = result.scalar_one_or_none()
        if not store:
            print(f"[error] 找不到門市「{STORE_NAME}」，請先確認 seed_admin.py 和門市已建立")
            return

        org_id = store.organization_id

        # Find or create employee role group
        rg_result = await session.execute(
            select(RoleGroup).where(
                RoleGroup.organization_id == org_id,
                RoleGroup.store_id == store.id,
                RoleGroup.name == "員工",
            )
        )
        emp_rg = rg_result.scalar_one_or_none()
        if not emp_rg:
            emp_rg = RoleGroup(
                organization_id=org_id,
                store_id=store.id,
                name="員工",
                permissions=["self.availability.edit", "self.schedule.view",
                              "self.preference.edit", "self.profile.edit"],
            )
            session.add(emp_rg)
            await session.flush()

        # Create employees + availability + preference
        created_users: list[User] = []
        for i, emp_data in enumerate(EMPLOYEES):
            existing = await session.execute(select(User).where(User.email == emp_data["email"]))
            user = existing.scalar_one_or_none()
            if user:
                print(f"[skip] {emp_data['name']} 已存在")
            else:
                user = User(
                    organization_id=org_id,
                    name=emp_data["name"],
                    email=emp_data["email"],
                    hashed_password=hash_password("test1234"),
                    is_active=True,
                )
                session.add(user)
                await session.flush()

                session.add(UserRoleGroup(user_id=user.id, role_group_id=emp_rg.id))

                # Availability for this week
                session.add(Availability(
                    user_id=user.id,
                    week_start=WEEK_START,
                    slots=EMPLOYEE_AVAILABILITY[i],
                    is_default_template=False,
                    locked=False,
                ))

                # Store preference (equal weight = 1.0 since only one store)
                session.add(StorePreference(
                    user_id=user.id,
                    store_id=store.id,
                    weight=1.0,
                ))

                print(f"[ok] 建立員工：{emp_data['name']}")
            created_users.append(user)

        # Create standing demand template (one per store, IDEA-15)
        dem_result = await session.execute(
            select(DemandTemplate).where(DemandTemplate.store_id == store.id)
        )
        if not dem_result.scalar_one_or_none():
            session.add(DemandTemplate(
                store_id=store.id,
                slots=make_demand(),
            ))
            print("[ok] 建立人力需求模板")

        await session.commit()
        print(f"\n✓ 完成！門市：{STORE_NAME}，週次：{WEEK_START}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
