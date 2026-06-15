import { apiFetch } from "@/lib/api-client";

export interface AvailabilityDTO {
  id: string;
  week_start: string;
  slots: boolean[][];  // [7][24]
  auto_filled: boolean;
  locked: boolean;
}

export interface AvailabilityTemplateDTO {
  id: string;
  user_id: string;
  slots: boolean[][];  // [7][24]
  updated_at: string;
}

export const fetchAvailability = (fromDate: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(`/users/me/availability?from_date=${fromDate}&weeks=4`, token);

export const fetchUserAvailability = (userId: string, week: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(`/users/${userId}/availability?week=${week}`, token);

export const fetchUserAvailabilityRange = (userId: string, fromDate: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(`/users/${userId}/availability?from_date=${fromDate}&weeks=4`, token);

export const saveAvailability = (weekStart: string, slots: boolean[][], token: string) =>
  apiFetch<AvailabilityDTO>(`/users/me/availability/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });

export const saveUserAvailability = (
  userId: string,
  weekStart: string,
  slots: boolean[][],
  token: string,
) =>
  apiFetch<AvailabilityDTO>(`/users/${userId}/availability/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });

// ── Standing weekly template (IDEA-11) ────────────────────────────────────────

export const fetchMyTemplate = (token: string) =>
  apiFetch<AvailabilityTemplateDTO | null>(`/users/me/availability-template`, token);

export const saveMyTemplate = (slots: boolean[][], token: string) =>
  apiFetch<AvailabilityTemplateDTO>(`/users/me/availability-template`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });

export const fetchUserTemplate = (userId: string, token: string) =>
  apiFetch<AvailabilityTemplateDTO | null>(`/users/${userId}/availability-template`, token);

export const saveUserTemplate = (userId: string, slots: boolean[][], token: string) =>
  apiFetch<AvailabilityTemplateDTO>(`/users/${userId}/availability-template`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });
