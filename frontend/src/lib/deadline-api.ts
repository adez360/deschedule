const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface DeadlineConfigDTO {
  store_id: string;
  days_before_week_start: number;
  deadline_time: string; // "HH:MM:SS"
}

export const fetchDeadlineConfig = (storeId: string, token: string): Promise<DeadlineConfigDTO> =>
  fetch(`${API}/api/stores/${storeId}/schedule-deadline-config`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (r.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
    if (!r.ok) throw new Error(`fetchDeadlineConfig ${r.status}`);
    return r.json();
  });

export const saveDeadlineConfig = (
  storeId: string,
  days_before_week_start: number,
  deadline_time: string,
  token: string,
): Promise<DeadlineConfigDTO> =>
  fetch(`${API}/api/stores/${storeId}/schedule-deadline-config`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ days_before_week_start, deadline_time: `${deadline_time}:00` }),
  }).then((r) => {
    if (!r.ok) throw new Error(`saveDeadlineConfig ${r.status}`);
    return r.json();
  });
