import { apiFetch } from "@/lib/api-client";

export interface DemandDTO {
  id: string;
  store_id: string;
  week_start: string;
  slots: number[][];  // [7][24]
}

export const fetchDemand = (storeId: string, weekStart: string, token: string) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand/${weekStart}`, token, { on404: "throw" });

export const fetchDemandMaybe = (storeId: string, weekStart: string, token: string) =>
  apiFetch<DemandDTO | null>(`/stores/${storeId}/demand/${weekStart}`, token, { on404: "null" });

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
