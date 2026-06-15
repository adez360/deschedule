"""Weekly auto-submit of standing availability (IDEA-11).

Every Friday (Celery beat, decision A2) this materializes each active employee's
AvailabilityTemplate into next week's Availability when that week has no row yet
(decision C1: only fill gaps, never overwrite). Rows it creates are flagged
auto_filled. Employees without a template are skipped and reported (decision E1).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.availability import Availability, AvailabilityTemplate
from app.models.user import User
from app.worker import celery_app

logger = logging.getLogger(__name__)

TZ = ZoneInfo("Asia/Taipei")


async def _auto_submit() -> dict:
    async with AsyncSessionLocal() as db:
        today = datetime.now(TZ).date()
        this_monday = today - timedelta(days=today.weekday())
        target_week = this_monday + timedelta(days=7)  # next week's Monday (decision B2)

        users = (
            await db.execute(select(User).where(User.is_active.is_(True)))
        ).scalars().all()
        templates = {
            t.user_id: t
            for t in (await db.execute(select(AvailabilityTemplate))).scalars().all()
        }
        already = set(
            (
                await db.execute(
                    select(Availability.user_id).where(
                        Availability.week_start == target_week
                    )
                )
            ).scalars().all()
        )

        created = 0
        missing_template: list[str] = []
        for user in users:
            tmpl = templates.get(user.id)
            if tmpl is None:
                missing_template.append(str(user.id))
                continue
            if user.id in already:
                continue  # week already has a row — leave it untouched (C1)
            db.add(
                Availability(
                    user_id=user.id,
                    week_start=target_week,
                    slots=tmpl.slots,
                    auto_filled=True,
                )
            )
            created += 1

        await db.commit()
        return {
            "target_week": target_week.isoformat(),
            "created": created,
            "missing_template": missing_template,
        }


@celery_app.task(name="app.tasks.availability.auto_submit_availability")
def auto_submit_availability() -> dict:
    result = asyncio.run(_auto_submit())
    if result["missing_template"]:
        logger.warning(
            "auto_submit_availability %s: filled %s weeks; %s active employees have no "
            "standing template: %s",
            result["target_week"],
            result["created"],
            len(result["missing_template"]),
            result["missing_template"],
        )
    else:
        logger.info(
            "auto_submit_availability %s: filled %s weeks; all active employees have a template",
            result["target_week"],
            result["created"],
        )
    return result
