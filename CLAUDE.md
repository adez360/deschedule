# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**For full design specifications — domain model, permission system, data schema, API routes, scheduling algorithm, and roadmap — see [PLAN.md](./PLAN.md).**

---

## Project Status

**Phase 1 complete** (2026-06-05). Phase 2 in progress. PLAN.md § 10 has the authoritative roadmap.

**Implemented pages:**
- `/login` — NextAuth credentials + JWT
- `/availability` — 7×24 drag-select grid, API-connected, fullscreen, mobile touch, scroll hints
- `/availability` (偏好 tab) — store preference weight bar, API-connected
- `/schedules` — employee grid + heatmap, generate/publish/archive, iCal popover, range-select manual scheduling
- `/settings/demand` — headcount + skill-tag demand, CRUD API, quick presets, fullscreen, mobile drag
- `/settings/deadline` — per-store deadline config, GET/PUT API
- `/settings/role-groups` — full CRUD, 18 permissions in 5 groups, member assign/revoke
- `/employees` — employee contract editor (FT/PT/CUSTOM), history, upsert API, skill assignment, home-store (所屬門市) selector
- `/payroll` — IDEA-06 dual-view (個人 / 門市) report: per-store management view, per-employee monthly view with base pay + adjustments (其他項目) + grand total; self-service for regular employees

---

## Tech Stack

**Frontend**: Next.js 15 (App Router), TypeScript 5, shadcn/ui + Tailwind CSS 4, TanStack Query v5, NextAuth.js v5, React Hook Form + Zod

**Backend**: FastAPI 0.115, Python 3.12, Pydantic v2, SQLAlchemy 2 async + asyncpg + Alembic, Celery + Redis, OR-Tools CP-SAT

**Infra**: PostgreSQL 16, Redis 7, Docker Compose (dev) / Kubernetes (prod), Nginx (`/` → Next.js :3000, `/api` → FastAPI :8000)

> Frontend API clients are hand-written in `src/lib/*.ts` — **not** orval-generated (orval is listed in the stack but not yet wired up).

---

## Key Implementation Notes

- `access_token_expire_minutes = 1440` (dev only — change before production)
- Grid cells: `touchAction: "none"` + container `onPointerMove + elementFromPoint` for mobile drag
- Trailing `0.75rem` grid column = right-side scroll zone on mobile (availability + demand)
- Fullscreen button: `rounded-md rounded-tl-2xl` to match outer card `rounded-2xl` corner
- Contract upsert: same `effective_from` → update in-place; different → close old + create new
- **Slots indexing**: `Availability.slots` and `DemandTemplate.slots` are `[7][24]` arrays (index 0 = Monday 00:00); `StoreSkillDemand.slots` is `boolean[7][24]`
- **JWT-expiry auto-logout**: `jwt` callback in `src/lib/auth.ts` decodes the access token `exp` claim and sets `token.error = "BackendTokenExpired"`; `<SessionGuard />` (rendered in the dashboard layout) watches `session.error` → calls `signOut` + redirects to `/login` with a toast
- **RoleGroup scope**: `store_ids: UUID[]` — empty = org-level, non-empty = scoped to those stores; editable after creation via checkbox-list UI in `/settings/role-groups`
- **Manual scheduling undo**: each batch assign/clear pushes a single undo closure; the inverse re-fetches current assignment IDs at execution time (not at capture time) to survive delete-recreate cycles
- **Payroll FT home-store rule (IDEA-06)**: `PayrollReport` still stores `monthly_salary_snapshot` per (user, store, week); the "FT salary counts only at `User.home_store_id`" rule is applied at **display time** (`storePay()` in `/payroll/page.tsx`), so changing an employee's home store doesn't require recomputing reports. Personal view adds a synthetic 0-hour home-store row if the FT had no shifts there that month.
- **Payroll permissions**: `GET /users/me/payroll` is open to any authenticated user (own data); store/org views + viewing others + editing adjustments require `employee.payroll.view`. Sidebar 薪資報表 lives in the 個人 group (visible to all). `PATCH /users/{id}` uses `exclude_unset` so `home_store_id` can be set or cleared to null.
- **Org-level joint scheduling (IDEA-10)**: `POST /organizations/{org_id}/schedules/generate` fills every store in one run (`scheduler.run_greedy_org`); cross-store mutual exclusion + global daily caps built in. Published/archived schedules and manual draft assignments are passed as `fixed` occupancy and never changed. Cross-store scope (G1): `Store.cross_group` label — an employee with `home_store_id` may only work at the home store + same-group stores; no home store = floats across role-group coverage. No minimum gap between cross-store shifts (F3). Stores PATCH uses `exclude_unset` so `cross_group`/`address` can be cleared.
