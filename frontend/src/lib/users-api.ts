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
  phone?: string | null;
}

// Invite link payload returned on create / resend (IDEA-12). The employee sets
// their own password via /onboard?token=… — managers never handle passwords.
export interface InviteResponse {
  user: UserDTO;
  invite_token: string;
  invite_expires_at: string;
}

/** Build the shareable onboarding link from an invite token (A1 — copy link). */
export const onboardUrl = (inviteToken: string) =>
  typeof window !== "undefined"
    ? `${window.location.origin}/onboard?token=${inviteToken}`
    : `/onboard?token=${inviteToken}`;

export const createUser = (orgId: string, body: UserCreateBody, token: string) =>
  apiFetch<InviteResponse>(`/organizations/${orgId}/users`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Re-issue an onboarding token: re-invite a pending employee, or reset an
 * active employee's password (IDEA-12 D1 + F). */
export const resendInvite = (orgId: string, userId: string, token: string) =>
  apiFetch<InviteResponse>(`/organizations/${orgId}/users/${userId}/resend-invite`, token, {
    method: "POST",
  });

// ── Public onboarding (no auth — token is the credential) ────────────────────

export interface OnboardInfo {
  name: string;
  nickname: string;
  email: string;
  phone: string | null;
  organization_name: string;
}

export interface OnboardSubmitBody {
  password: string;
  name?: string;
  nickname?: string;
  phone?: string | null;
}

async function onboardFetch<T>(inviteToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/onboard/${inviteToken}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fetchOnboardInfo = (inviteToken: string) =>
  onboardFetch<OnboardInfo>(inviteToken);

export const submitOnboard = (inviteToken: string, body: OnboardSubmitBody) =>
  onboardFetch<void>(inviteToken, { method: "POST", body: JSON.stringify(body) });

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

/** Self-service password change (IDEA-16). 400 = wrong current password,
 * 409 = pending account (no password yet). */
export const changeMyPassword = (
  body: { current_password: string; new_password: string },
  token: string,
) =>
  apiFetch<void>("/users/me/password", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
