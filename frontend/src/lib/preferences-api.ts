const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface StorePreferenceDTO {
  id: string;
  store_id: string;
  weight: number;
}

export const fetchMyPreferences = (token: string): Promise<StorePreferenceDTO[]> =>
  fetch(`${API}/api/users/me/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`fetchPreferences ${r.status}`);
    return r.json();
  });

export const saveMyPreferences = (
  preferences: { store_id: string; weight: number }[],
  token: string,
): Promise<StorePreferenceDTO[]> =>
  fetch(`${API}/api/users/me/preferences`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ preferences }),
  }).then((r) => {
    if (!r.ok) throw new Error(`savePreferences ${r.status}`);
    return r.json();
  });
