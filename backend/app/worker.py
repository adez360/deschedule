from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "schedule_system",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.availability"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Taipei",
    enable_utc=True,
    beat_schedule={
        # IDEA-11 A2: every Friday 23:00 Asia/Taipei, copy each employee's standing
        # template into next week's availability.
        "auto-submit-availability-weekly": {
            "task": "app.tasks.availability.auto_submit_availability",
            "schedule": crontab(day_of_week="fri", hour=23, minute=0),
        },
    },
)
