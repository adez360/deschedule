import { apiFetch } from "@/lib/api-client";

export interface StorePreferenceDTO {
  id: string;
  store_id: string;
  weight: number;
}

export const fetchMyPreferences = (token: string) =>
  apiFetch<StorePreferenceDTO[]>(`/users/me/preferences`, token);

export const saveMyPreferences = (
  preferences: { store_id: string; weight: number }[],
  token: string,
) =>
  apiFetch<StorePreferenceDTO[]>(`/users/me/preferences`, token, {
    method: "PUT",
    body: JSON.stringify({ preferences }),
  });
