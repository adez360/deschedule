export interface AvailabilityDTO {
  id: string;
  week_start: string;
  slots: boolean[][];  // [7][24]
  is_default_template: boolean;
  locked: boolean;
}

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const fetchAvailability = (fromDate: string, token: string) =>
  apiFetch<AvailabilityDTO[]>(
    `/users/me/availability?from_date=${fromDate}&weeks=4`,
    token,
  );

export const saveAvailability = (
  weekStart: string,
  slots: boolean[][],
  token: string,
) =>
  apiFetch<AvailabilityDTO>(`/users/me/availability/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify({ slots, is_default_template: false }),
  });
