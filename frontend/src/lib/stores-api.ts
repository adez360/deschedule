import { apiFetch } from "@/lib/api-client";
import type { StoreDTO } from "@/lib/schedules-api";

export type { StoreDTO };

export interface StoreBody {
  name: string;
  timezone: string;
  cross_group?: string | null;
}

export const createStore = (orgId: string, body: StoreBody, token: string) =>
  apiFetch<StoreDTO>(`/organizations/${orgId}/stores`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateStore = (storeId: string, body: Partial<StoreBody>, token: string) =>
  apiFetch<StoreDTO>(`/stores/${storeId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteStore = (storeId: string, token: string) =>
  apiFetch<void>(`/stores/${storeId}`, token, { method: "DELETE" });
