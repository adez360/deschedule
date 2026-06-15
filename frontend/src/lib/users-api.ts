import { apiFetch } from "@/lib/api-client";
import type { UserDTO } from "@/lib/schedules-api";

export interface UserUpdateBody {
  daily_hour_max?: number | null;
  name?: string;
  nickname?: string;
  avatar_url?: string | null;
  note?: string | null;
  hire_date?: string | null;
  phone?: string | null;
  home_store_id?: string | null;
}

export const updateUser = (userId: string, body: UserUpdateBody, token: string) =>
  apiFetch<UserDTO>(`/users/${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export interface UserCreateBody {
  name: string;
  nickname?: string | null;
  email: string;
  password: string;
  phone?: string | null;
}

export const createUser = (orgId: string, body: UserCreateBody, token: string) =>
  apiFetch<UserDTO>(`/organizations/${orgId}/users`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const setUserActive = (userId: string, active: boolean, token: string) =>
  apiFetch<UserDTO>(`/users/${userId}/${active ? "activate" : "deactivate"}`, token, {
    method: "PATCH",
  });

export const fetchMe = (token: string) => apiFetch<UserDTO>("/users/me", token);

export const updateMe = (body: UserUpdateBody, token: string) =>
  apiFetch<UserDTO>("/users/me", token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
