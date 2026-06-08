"""iCal subscription endpoints — no auth header required, token IS the credential."""
import uuid
from datetime import date, datetime, timedelta, timezone
from itertools import groupby

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import decode_token
from app.models.schedule import Assignment, Schedule, ScheduleStatus
from app.models.store import Store
from app.models.user import User

router = APIRouter(prefix="/calendar", tags=["calendar"])

TW_TZ = timezone(timedelta(hours=8))
CRLF = "\r\n"


# ─── Helpers ───────────────────────────────────────────────────────────────

def _to_utc_str(d: date, day_offset: int, hour: int) -> str:
    dt = datetime(d.year, d.month, d.day, hour, 0, 0, tzinfo=TW_TZ)
    dt += timedelta(days=day_offset)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _now_utc_str() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ical_fold(line: str) -> str:
    """Fold lines longer than 75 octets per RFC 5545."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    parts = []
    while len(encoded) > 75:
        parts.append(encoded[:75].decode("utf-8", errors="ignore"))
        encoded = encoded[75:]
    parts.append(encoded.decode("utf-8", errors="ignore"))
    return ("\r\n ").join(parts)


def _build_vevent(
    uid: str,
    dtstart: str,
    dtend: str,
    summary: str,
    description: str,
    dtstamp: str,
) -> str:
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        _ical_fold(f"SUMMARY:{summary}"),
        "SEQUENCE:0",
        "STATUS:CONFIRMED",
    ]
    if description:
        lines.append(_ical_fold(f"DESCRIPTION:{description}"))
    lines.append("END:VEVENT")
    return CRLF.join(lines)


def _build_calendar(cal_name: str, vevents: list[str]) -> str:
    header = CRLF.join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Schedule System//ZH-TW",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{cal_name}",
        "X-WR-TIMEZONE:Asia/Taipei",
        "X-WR-CALDESC:排班系統自動同步",
    ])
    footer = "END:VCALENDAR"
    body = CRLF.join(vevents) if vevents else ""
    return header + CRLF + (body + CRLF if body else "") + footer + CRLF


def _group_into_shifts(
    assignments: list[Assignment],
    week_start: date,
    store_name: str,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
) -> list[str]:
    """Group consecutive hour assignments into VEVENT blocks."""
    dtstamp = _now_utc_str()
    vevents: list[str] = []

    # Sort by day, hour
    sorted_a = sorted(assignments, key=lambda a: (a.day, a.hour))

    i = 0
    while i < len(sorted_a):
        start = sorted_a[i]
        j = i + 1
        while (
            j < len(sorted_a)
            and sorted_a[j].day == sorted_a[j - 1].day
            and sorted_a[j].hour == sorted_a[j - 1].hour + 1
        ):
            j += 1

        end_hour = sorted_a[j - 1].hour + 1
        is_manual = any(a.is_manual for a in sorted_a[i:j])

        uid = f"sched-{schedule_id}-{user_id}-d{start.day}-h{start.hour}@schedule-system"
        dtstart = _to_utc_str(week_start, start.day, start.hour)
        dtend = _to_utc_str(week_start, start.day, end_hour % 24 if end_hour < 24 else 0) if end_hour == 24 else _to_utc_str(week_start, start.day, end_hour)
        if end_hour == 24:
            dtend = _to_utc_str(week_start, start.day + 1, 0)

        desc = "手動排班" if is_manual else ""
        vevents.append(_build_vevent(
            uid=uid,
            dtstart=dtstart,
            dtend=dtend,
            summary=f"{store_name} 班次",
            description=desc,
            dtstamp=dtstamp,
        ))
        i = j

    return vevents


# ─── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/{calendar_token}/personal.ics", response_class=Response)
async def personal_calendar(
    calendar_token: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Personal iCal feed — returns all published assignments for the token owner."""
    result = await db.execute(
        select(User).where(User.calendar_token == calendar_token)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid calendar token")

    # Fetch all published assignments for this user, with schedule + store
    result = await db.execute(
        select(Assignment)
        .join(Schedule, Assignment.schedule_id == Schedule.id)
        .join(Store, Assignment.store_id == Store.id)
        .options(selectinload(Assignment.schedule), selectinload(Assignment.user))
        .where(
            Assignment.user_id == user.id,
            Schedule.status == ScheduleStatus.PUBLISHED,
        )
        .order_by(Schedule.week_start, Assignment.day, Assignment.hour)
    )
    assignments = result.scalars().all()

    # Fetch store names once
    store_ids = list({a.store_id for a in assignments})
    store_names: dict[uuid.UUID, str] = {}
    if store_ids:
        sr = await db.execute(select(Store).where(Store.id.in_(store_ids)))
        for store in sr.scalars().all():
            store_names[store.id] = store.name

    # Group by (schedule_id, store_id) then into shift blocks
    all_vevents: list[str] = []
    key_fn = lambda a: (a.schedule_id, a.store_id)
    for (schedule_id, store_id), group in groupby(
        sorted(assignments, key=key_fn), key=key_fn
    ):
        group_list = list(group)
        week_start = group_list[0].schedule.week_start
        store_name = store_names.get(store_id, "門市")
        all_vevents.extend(_group_into_shifts(
            group_list, week_start, store_name, user.id, schedule_id
        ))

    cal = _build_calendar(f"{user.name} 的班表", all_vevents)
    return Response(
        content=cal,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="schedule.ics"'},
    )


@router.get("/{calendar_token}/store/{store_id}.ics", response_class=Response)
async def store_calendar(
    calendar_token: uuid.UUID,
    store_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Store iCal feed — returns published assignments for the specified store."""
    result = await db.execute(
        select(User).where(User.calendar_token == calendar_token)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid calendar token")

    store_result = await db.execute(select(Store).where(Store.id == store_id))
    store = store_result.scalar_one_or_none()
    if store is None or store.organization_id != user.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")

    result = await db.execute(
        select(Assignment)
        .join(Schedule, Assignment.schedule_id == Schedule.id)
        .options(selectinload(Assignment.schedule), selectinload(Assignment.user))
        .where(
            Assignment.store_id == store_id,
            Schedule.status == ScheduleStatus.PUBLISHED,
        )
        .order_by(Schedule.week_start, Assignment.user_id, Assignment.day, Assignment.hour)
    )
    assignments = result.scalars().all()

    # Fetch user names
    user_ids = list({a.user_id for a in assignments})
    user_names: dict[uuid.UUID, str] = {}
    if user_ids:
        ur = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in ur.scalars().all():
            user_names[u.id] = u.name

    all_vevents: list[str] = []
    key_fn = lambda a: (a.schedule_id, a.user_id)
    for (schedule_id, uid), group in groupby(
        sorted(assignments, key=key_fn), key=key_fn
    ):
        group_list = list(group)
        week_start = group_list[0].schedule.week_start
        employee_name = user_names.get(uid, "員工")
        vevents = _group_into_shifts(
            group_list, week_start, store.name, uid, schedule_id
        )
        # Override summary to include employee name
        vevents_named = [v.replace(f"SUMMARY:{store.name} 班次", f"SUMMARY:{employee_name} · {store.name}") for v in vevents]
        all_vevents.extend(vevents_named)

    cal = _build_calendar(f"{store.name} 班表", all_vevents)
    return Response(
        content=cal,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{store.name}-schedule.ics"'},
    )


# ─── Token info endpoint (requires auth) ───────────────────────────────────

bearer = HTTPBearer()


@router.get("/me/token")
async def get_my_calendar_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Returns the current user's calendar subscription URLs."""
    try:
        payload = decode_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    token = str(user.calendar_token)
    return {
        "calendar_token": token,
        "personal_url": f"/api/calendar/{token}/personal.ics",
    }
