import { apiFetch } from "@/lib/api-client";

export interface DeadlineConfigDTO {
  store_id: string;
  days_before_week_start: number;
  deadline_time: string; // "HH:MM:SS"
}

export const fetchDeadlineConfig = (storeId: string, token: string) =>
  apiFetch<DeadlineConfigDTO>(`/stores/${storeId}/schedule-deadline-config`, token, {
    on404: "throw",
  });

export const saveDeadlineConfig = (
  storeId: string,
  days_before_week_start: number,
  deadline_time: string,
  token: string,
) =>
  apiFetch<DeadlineConfigDTO>(`/stores/${storeId}/schedule-deadline-config`, token, {
    method: "PUT",
    body: JSON.stringify({ days_before_week_start, deadline_time: `${deadline_time}:00` }),
  });
