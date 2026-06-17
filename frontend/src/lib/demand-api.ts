import { apiFetch } from "@/lib/api-client";

export interface DemandDTO {
  id: string;
  store_id: string;
  slots: number[][];  // [7][24]
}

// Standing demand — one per store, applies to every week (IDEA-15).
export const fetchDemand = (storeId: string, token: string) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand`, token, { on404: "throw" });

export const fetchDemandMaybe = (storeId: string, token: string) =>
  apiFetch<DemandDTO | null>(`/stores/${storeId}/demand`, token, { on404: "null" });

export const saveDemand = (storeId: string, slots: number[][], token: string) =>
  apiFetch<DemandDTO>(`/stores/${storeId}/demand`, token, {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });

export const emptySlots = (): number[][] =>
  Array.from({ length: 7 }, () => Array(24).fill(0));
