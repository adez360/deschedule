# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Phase 1 complete** (as of 2026-06-05). All MVP features are implemented and connected to real APIs. PLAN.md is the authoritative design document (v0.4, 2026-06-06).

**Implemented pages:**
- `/login` — NextAuth credentials + JWT
- `/availability` — 7×24 drag-select grid, API-connected, fullscreen, mobile touch, scroll hints
- `/availability` (偏好 tab) — store preference weight bar, API-connected
- `/schedules` — employee grid + heatmap, generate/publish/archive, iCal popover
- `/settings/demand` — demand config, CRUD API, quick presets, fullscreen, mobile drag
- `/settings/deadline` — per-store deadline config, GET/PUT API
- `/settings/role-groups` — full CRUD, 18 permissions in 5 groups, member assign/revoke
- `/employees` — employee contract editor (FT/PT/CUSTOM), history, upsert API

**Key implementation notes:**
- Frontend API clients are hand-written in `src/lib/*.ts` (not orval-generated)
- `access_token_expire_minutes = 1440` (dev only — change before production)
- Grid cells use `touchAction: "none"` + container `onPointerMove + elementFromPoint` for mobile drag
- Trailing `0.75rem` grid column = right-side scroll zone on mobile (availability + demand)
- Fullscreen button: `rounded-md rounded-tl-2xl` to match outer card `rounded-2xl` corner
- Contract upsert: same `effective_from` → update in-place; different → close old + create new
- **JWT-expiry auto-logout**: backend tokens expire in 24h but NextAuth sessions persist 30 days, causing silent 401s. The `jwt` callback in `src/lib/auth.ts` decodes the access token's `exp` claim and sets `token.error = "BackendTokenExpired"`; `<SessionGuard />` (rendered in the dashboard layout) watches `session.error` and calls `signOut` + redirects to `/login` with a toast
- **RoleGroup scope is multi-select**: `store_ids: UUID[]` (not a single `store_id`) — empty array = org-level, non-empty = scoped to those specific stores; editable after creation via a checkbox-list UI in `/settings/role-groups`

---

## Tech Stack (Decided)

### Frontend
- **Next.js 15** (App Router) — SSR + Client Components
- **TypeScript 5**
- **shadcn/ui** + **Tailwind CSS 4** for components and styling
- **dnd-kit** for drag-and-drop scheduling
- **React Hook Form + Zod** for form validation
- **TanStack Query v5** for server state / API caching
- **NextAuth.js v5** (Auth.js) — JWT + HttpOnly Cookie
- **orval** — auto-generates TypeScript API client + Zod schemas from FastAPI's OpenAPI spec; run after any backend schema change

### Backend
- **FastAPI 0.115** + **Python 3.12**
- **Pydantic v2** for request/response schemas
- **SQLAlchemy 2 (async)** + **asyncpg** + **Alembic** for migrations
- **Celery + Redis** for async scheduling computation and email notifications
- **Google OR-Tools (CP-SAT)** for MILP schedule solving

### Infrastructure
- **PostgreSQL 16** — JSONB for `slots` fields (7×24 boolean/int arrays)
- **Redis 7** — session cache, Celery broker, scheduling temp cache
- **Docker Compose** for development; Kubernetes for production
- **Nginx** reverse proxy routing `/` → Next.js :3000, `/api` → FastAPI :8000

---

## System Architecture

```
Browser/Mobile
    │ HTTPS
    ▼
Nginx
├──▶ Next.js :3000   (SSR + React)
│         │ REST (orval-generated TypeScript client)
└──▶ FastAPI :8000
          ├──▶ PostgreSQL :5432
          ├──▶ Redis :6379
          └──▶ Celery Worker (OR-Tools scheduling, emails)
```

Type sync flow: FastAPI Pydantic schemas → `openapi.json` → orval → TypeScript client + Zod schemas (imported by frontend).

---

## Domain Model

Key entities and their relationships:

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `Organization` | `id`, `name`, `owner_user_id` | Top-level tenant |
| `Store` | `id`, `organization_id`, `timezone` | Multiple stores per org |
| `User` | `id`, `organization_id`, `role_groups[]` | Not bound to a single store |
| `RoleGroup` | `store_ids[]` (empty = org-level), `permissions[]` | Users can hold multiple across stores; scope can cover multiple stores at once and is editable after creation |
| `UserRoleGroup` | `user_id`, `role_group_id`, `granted_at` | Join table |
| `EmployeeContract` | `user_id`, `store_id`, `hourly_rate`, `weekly_hour_max` | Per store per employee |
| `StorePreference` | `user_id`, `store_id`, `weight` (0.0–1.0) | All weights for a user must sum to 1.0 |
| `Availability` | `user_id`, `week_start` (Monday), `slots: bool[7][24]`, `is_default_template`, `locked` | Employees fill up to 4 weeks ahead |
| `DemandTemplate` | `store_id`, `week_start`, `slots: int[7][24]` | Required headcount per slot |
| `ScheduleDeadlineConfig` | `store_id`, `days_before_week_start` (default 2 = Saturday), `deadline_time` | Per-store deadline rules |
| `Schedule` | `store_id`, `week_start`, `status: draft/published/archived` | One per store per week |
| `Assignment` | `schedule_id`, `user_id`, `store_id`, `day` (0=Mon), `hour` (0–23), `is_manual` | Manual assignments survive re-generation |
| `PayrollReport` | `user_id`, `store_id`, `week_start`, `total_hours`, `hourly_rate_snapshot`, `gross_pay` | Snapshot at calculation time |

---

## Key Design Decisions

- **Employees are not bound to a single store** — store association is via store-level `RoleGroup` (with `store_ids` non-empty). An employee can hold role groups at multiple stores simultaneously.
- **`is_manual = true` assignments** are never overwritten by auto-scheduling re-runs.
- **Availability locking**: after the `ScheduleDeadlineConfig` deadline, `Availability.locked = true` — employees can't modify that week. Managers with `store.schedule.edit` can always modify schedules regardless of lock state.
- **Schedule status flow**: `draft` → `published` → `archived`. Archived triggers automatic `PayrollReport` generation.
- **`hourly_rate_snapshot`** is stored on `PayrollReport` so historical reports are unaffected by future contract changes.
- **Org-level RoleGroups** (`store_ids = []`) apply to all stores in the organization; non-empty `store_ids` scopes the group to exactly those stores (can be more than one).
- **Slots fields** (`Availability.slots`, `DemandTemplate.slots`) are `[7][24]` arrays; index 0 = Monday 00:00.

---

## Permission System

Permissions are assigned to RoleGroups, which are assigned to users.

| Scope | Permission | Description |
|-------|-----------|-------------|
| System | `system.all` | Full platform access |
| Org | `org.manage` | Manage org settings, role groups, users |
| Org | `org.schedule.view_all` | View all store schedules |
| Org | `org.schedule.arrange` | Trigger auto-scheduling |
| Org | `org.employee.manage` | Add/disable/transfer employees |
| Store | `store.schedule.view` | View own store's schedule |
| Store | `store.schedule.edit` | Manually edit schedule |
| Store | `store.demand.edit` | Edit headcount demand |
| Store | `store.schedule.deadline.manage` | Configure deadline settings |
| Self | `self.schedule.view` | View own schedule |
| Self | `self.availability.edit` | Edit own availability |
| Self | `self.preference.edit` | Edit own store preferences |
| Self | `self.profile.edit` | Edit own profile |
| Cross-employee | `employee.availability.edit` | Edit any employee's availability |
| Cross-employee | `employee.payroll.view` | View work hours and payroll reports |
| Cross-employee | `employee.contract.edit` | Set hourly rate / contract type |

---

## Scheduling Algorithm

- **Phase 1 MVP**: greedy heuristic
- **Phase 3**: MILP via OR-Tools CP-SAT

**Objective**: maximize `Σ preference_weight(employee, store) × availability(employee, slot)`

**Constraints**: demand satisfaction, availability, shift continuity, daily max hours (default 8), weekly max hours, same-day cross-store commute restriction.

**Scale thresholds**: < 50 employees, < 5 stores → direct MILP; larger → greedy init + local search.

---

## Development Phases

- **Phase 1 (MVP) — ✅ COMPLETE (2026-06-05)**: Auth, org/store CRUD, role groups, availability UI, store preference UI, contracts, demand config, greedy auto-scheduling, schedule grid view, status transitions, deadline config, iCal subscription, dark/light mode, mobile touch drag, fullscreen
- **Phase 2 (~6 weeks)**: Drag-and-drop scheduling, history view, payroll reports, CSV/PDF export, email notifications, default availability templates
- **Phase 3 (~4 weeks)**: OR-Tools MILP solver, multi-week parallel view, PWA push notifications, auto payroll on archive, i18n (zh-TW/en), full audit log UI, performance tuning

---

## UI Reference

- `reference-img/img001-LocationWeightControl.webp` — Store preference weight control: top color-block bar (drag arrows to adjust adjacent weights) + checklist of stores (unchecked = weight 0, excluded from bar)
- `reference-img/img002-SeheduleSelect.webp` — Availability grid: week tabs at top (up to 4 future weeks), 7×24 grid (green = selected, blue-purple = drag-selecting, gray = unselected), supports drag-select and scroll
