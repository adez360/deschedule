import { apiFetch } from "@/lib/api-client";

export interface AvailabilityDTO {
  id: string;
  week_start: string;
  slots: boolean[][];  // [7][24]
  is_default_template: boolean;
  locked: boolean;
}

export const fetchAvailability = (fromDate: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(`/users/me/availability?from_date=${fromDate}&weeks=4`, token);

export const fetchUserAvailability = (userId: string, week: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(`/users/${userId}/availability?week=${week}`, token);

export const saveAvailability = (weekStart: string, slots: boolean[][], token: string) =>
  apiFetch<AvailabilityDTO>(`/users/me/availability/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify({ slots, is_default_template: false }),
  });
