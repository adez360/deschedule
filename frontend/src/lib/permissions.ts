import type { Session } from "next-auth";

type SessionUser = Session["user"];

/**
 * Client-side permission check against the session's role groups (IDEA-16).
 * `system.all` is the super-admin wildcard — it matches any query. Mirrors the
 * backend `has()` helper and the original inline check in `app-sidebar.tsx`.
 */
export function hasPermission(user: SessionUser, perms: string[]): boolean {
  return (
    user.role_groups?.some((rg) =>
      rg.permissions.some((p) => p === "system.all" || perms.includes(p)),
    ) ?? false
  );
}

/** Can arrange schedules (store- or org-level) → sees the scheduling console. */
export const isScheduleManager = (user: SessionUser) =>
  hasPermission(user, [
    "store.schedule.edit",
    "org.schedule.arrange",
    "org.schedule.view_all",
  ]);

/** Org administrator (or super-admin). */
export const isOrgAdmin = (user: SessionUser) =>
  hasPermission(user, ["org.manage", "system.all"]);
