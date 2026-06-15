import { apiFetch } from "@/lib/api-client";

export interface StoreDTO { id: string; name: string; timezone: string; cross_group?: string | null }
export interface UserDTO  {
  id: string; name: string; nickname?: string; email: string;
  phone?: string | null; avatar_url?: string | null; note?: string | null;
  hire_date?: string | null; home_store_id?: string | null;
  daily_hour_max?: number | null; is_active?: boolean; is_pending?: boolean;
  contract_type?: "FT" | "PT" | "CUSTOM" | null;
  role_groups?: { id: string; name: string }[];
}
export interface AssignmentDTO {
  id: string; schedule_id: string; user_id: string; store_id: string;
  day: number; hour: number; is_manual: boolean;
}
export interface ScheduleSummaryDTO {
  id: string; store_id: string; week_start: string;
  status: "draft" | "published" | "archived";
}
export interface ScheduleDetailDTO extends ScheduleSummaryDTO {
  assignments: AssignmentDTO[];
}
export interface ShiftBlock { start: number; end: number; isManual: boolean }

// ─── API calls ──────────────────────────────────────────────────────────────

export const fetchStores = (orgId: string, token: string) =>
  apiFetch<StoreDTO[]>(`/organizations/${orgId}/stores`, token);

export const fetchOrgUsers = (orgId: string, token: string) =>
  apiFetch<UserDTO[]>(`/organizations/${orgId}/users`, token);

export const fetchScheduleList = (storeId: string, token: string) =>
  apiFetch<ScheduleSummaryDTO[]>(`/stores/${storeId}/schedules`, token);

export const fetchScheduleDetail = (scheduleId: string, token: string) =>
  apiFetch<ScheduleDetailDTO>(`/schedules/${scheduleId}`, token);

/** Org-level joint scheduling (IDEA-10): regenerates every draft schedule in the org for the week. */
export const generateSchedules = (orgId: string, weekStart: string, token: string) =>
  apiFetch<ScheduleDetailDTO[]>(`/organizations/${orgId}/schedules/generate`, token, {
    method: "POST",
    body: JSON.stringify({ week_start: weekStart }),
  });

export const createAssignment = (
  scheduleId: string,
  userId: string,
  day: number,
  hour: number,
  token: string,
) =>
  apiFetch<AssignmentDTO>(`/schedules/${scheduleId}/assignments`, token, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, day, hour }),
  });

export const deleteAssignment = (scheduleId: string, assignmentId: string, token: string) =>
  apiFetch<void>(`/schedules/${scheduleId}/assignments/${assignmentId}`, token, {
    method: "DELETE",
  });

export const updateScheduleStatus = (
  scheduleId: string,
  status: "published" | "archived",
  token: string,
) =>
  apiFetch<ScheduleSummaryDTO>(`/schedules/${scheduleId}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

// ─── Data transformation ────────────────────────────────────────────────────

export interface EmployeeRow {
  id: string;
  name: string;
  shifts: Record<number, ShiftBlock[]>;  // day 0-6 → shift blocks
}

/** Group consecutive hour assignments into shift blocks, per user per day. */
export function buildEmployeeRows(
  assignments: AssignmentDTO[],
  users: UserDTO[],
): EmployeeRow[] {
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Group by user
  const byUser = new Map<string, AssignmentDTO[]>();
  for (const a of assignments) {
    const arr = byUser.get(a.user_id) ?? [];
    arr.push(a);
    byUser.set(a.user_id, arr);
  }

  const rows: EmployeeRow[] = [];
  for (const [userId, userAssignments] of byUser) {
    const shifts: Record<number, ShiftBlock[]> = {};

    // Group by day
    const byDay = new Map<number, AssignmentDTO[]>();
    for (const a of userAssignments) {
      const arr = byDay.get(a.day) ?? [];
      arr.push(a);
      byDay.set(a.day, arr);
    }

    for (const [day, dayAssignments] of byDay) {
      dayAssignments.sort((a, b) => a.hour - b.hour);
      const blocks: ShiftBlock[] = [];
      let i = 0;
      while (i < dayAssignments.length) {
        let j = i + 1;
        while (
          j < dayAssignments.length &&
          dayAssignments[j].hour === dayAssignments[j - 1].hour + 1
        ) j++;
        blocks.push({
          start: dayAssignments[i].hour,
          end: dayAssignments[j - 1].hour + 1,
          isManual: dayAssignments.slice(i, j).some((a) => a.is_manual),
        });
        i = j;
      }
      shifts[day] = blocks;
    }

    rows.push({
      id: userId,
      name: userMap.get(userId)?.name ?? "未知員工",
      shifts,
    });
  }

  // Sort by total weekly hours desc, then name
  return rows.sort((a, b) => {
    const hoursA = Object.values(a.shifts).flat().reduce((s, sh) => s + sh.end - sh.start, 0);
    const hoursB = Object.values(b.shifts).flat().reduce((s, sh) => s + sh.end - sh.start, 0);
    return hoursB - hoursA || a.name.localeCompare(b.name);
  });
}

/** Build actual headcount per day×hour from assignments. */
export function buildActual(assignments: AssignmentDTO[]): number[][] {
  const actual = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of assignments) actual[a.day][a.hour]++;
  return actual;
}
