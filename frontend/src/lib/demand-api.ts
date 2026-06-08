export interface DemandDTO {
  id: string;
  store_id: string;
  week_start: string;
  slots: number[][];  // [7][24]
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
    if (res.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const fetchDemand = (storeId: string, weekStart: string, token: string) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand/${weekStart}`, token);

export const saveDemand = (storeId: string, weekStart: string, slots: number[][], token: string) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });

export const copyDemandFromWeek = (
  storeId: string,
  targetWeek: string,
  sourceWeek: string,
  token: string,
) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand/${targetWeek}/copy-from/${sourceWeek}`, token, {
    method: "POST",
  });

export const emptySlots = (): number[][] =>
  Array.from({ length: 7 }, () => Array(24).fill(0));
