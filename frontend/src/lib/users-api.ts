import { apiFetch } from "@/lib/api-client";
import type { UserDTO } from "@/lib/schedules-api";

export interface UserUpdateBody {
  name?: string;
  phone?: string;
  home_store_id?: string | null;
}

export const updateUser = (userId: string, body: UserUpdateBody, token: string) =>
  apiFetch<UserDTO>(`/users/${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
