"""
建立跨店排班測試資料（IDEA-10）：3 名員工，涵蓋跨店群組、每日上限、浮動人力情境。
用法：
    docker compose exec backend python scripts/seed_cross_store_test.py

前提：seed_test_data.py 已執行（門市A/B/C、組織、「員工」角色群組皆已存在），
且門市A/B 已設定 cross_group="北區"、門市C 無群組。

情境設計（週次 2026-06-15）：
- 門市A 需求 24h/day（1人），門市B 需求 10-18（1人），門市C 需求 10-18（1人）
- 林小華：home_store=門市B（北區錨點，可跨 A/B），08-20 全天可用，偏好 A=0.3 / B=0.7
  → 預期被覆蓋率優先 augment pass 拉去支援 A 的缺口時段
- 周建宏：home_store=門市A，daily_hour_max=4，06-22 全天可用，偏好 A=0.8 / B=0.2
  → 即使可用 16h/day，每日仍應被排班器限制在 4h
- 吳雅婷：無 home_store（浮動人力，受角色群組覆蓋範圍 = 全組織），09-21 全天可用，
  偏好 A=0.34 / B=0.33 / C=0.33 → 可被排到 A/B/C 任一店（包含無跨店群組的 C）
"""
import asyncio
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import hash_password
from app.models.availability import Availability, StorePreference
from app.models.role_group import RoleGroup, UserRoleGroup
from app.models.store import Store
from app.models.user import User

WEEK_START = date(2026, 6, 15)  # Monday


def make_slots(start_hour: int, end_hour: int) -> list[list[bool]]:
    """Every day of the week, available from start_hour..end_hour (exclusive)."""
    row = [False] * 24
    for h in range(start_hour, end_hour):
        row[h] = True
    return [row[:] for _ in range(7)]


EMPLOYEES = [
    {
        "name": "林小華",
        "email": "lin@example.com",
        "home_store": "門市B",
        "daily_hour_max": None,
        "avail": make_slots(8, 20),
        "prefs": {"門市A": 0.3, "門市B": 0.7},
    },
    {
        "name": "周建宏",
        "email": "zhou@example.com",
        "home_store": "門市A",
        "daily_hour_max": 4,
        "avail": make_slots(6, 22),
        "prefs": {"門市A": 0.8, "門市B": 0.2},
    },
    {
        "name": "吳雅婷",
        "email": "wu@example.com",
        "home_store": None,
        "daily_hour_max": None,
        "avail": make_slots(9, 21),
        "prefs": {"門市A": 0.34, "門市B": 0.33, "門市C": 0.33},
    },
]


async def seed() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        stores_result = await session.execute(select(Store))
        stores_by_name = {s.name: s for s in stores_result.scalars().all()}
        for name in ("門市A", "門市B", "門市C"):
            if name not in stores_by_name:
                print(f"[error] 找不到門市「{name}」，請先執行 seed_test_data.py")
                return

        org_id = stores_by_name["門市A"].organization_id

        rg_result = await session.execute(
            select(RoleGroup).where(
                RoleGroup.organization_id == org_id,
                RoleGroup.name == "員工",
            )
        )
        emp_rg = rg_result.scalar_one_or_none()
        if not emp_rg:
            print("[error] 找不到「員工」角色群組，請先執行 seed_test_data.py")
            return

        for emp in EMPLOYEES:
            existing = await session.execute(select(User).where(User.email == emp["email"]))
            user = existing.scalar_one_or_none()
            if user:
                print(f"[skip] {emp['name']} 已存在")
                continue

            home_store = stores_by_name[emp["home_store"]] if emp["home_store"] else None
            user = User(
                organization_id=org_id,
                name=emp["name"],
                email=emp["email"],
                hashed_password=hash_password("test1234"),
                is_active=True,
                home_store_id=home_store.id if home_store else None,
                daily_hour_max=emp["daily_hour_max"],
            )
            session.add(user)
            await session.flush()

            session.add(UserRoleGroup(user_id=user.id, role_group_id=emp_rg.id))

            session.add(Availability(
                user_id=user.id,
                week_start=WEEK_START,
                slots=emp["avail"],
                is_default_template=False,
                locked=False,
            ))

            for store_name, weight in emp["prefs"].items():
                session.add(StorePreference(
                    user_id=user.id,
                    store_id=stores_by_name[store_name].id,
                    weight=weight,
                ))

            home_label = emp["home_store"] or "（浮動）"
            cap_label = emp["daily_hour_max"] if emp["daily_hour_max"] is not None else "預設(8h)"
            print(f"[ok] 建立員工：{emp['name']}（所屬門市={home_label}，每日上限={cap_label}）")

        await session.commit()
        print(f"\n✓ 完成！週次：{WEEK_START}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
