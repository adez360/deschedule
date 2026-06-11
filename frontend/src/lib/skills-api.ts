import { apiFetch } from "@/lib/api-client";

export interface SkillDTO {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}

export interface UserSkillDTO {
  user_id: string;
  skill_id: string;
  granted_at: string;
  skill: SkillDTO;
}

export interface StoreSkillDemandDTO {
  id: string;
  store_id: string;
  week_start: string;
  skill_id: string;
  slots: boolean[][]; // [7][24] — true = this skill is needed in this slot
  updated_at: string;
  skill: SkillDTO;
}

// ── Skill CRUD (org-level) ──────────────────────────────────────────────────

export const fetchSkills = (orgId: string, token: string) =>
  apiFetch<SkillDTO[]>(`/organizations/${orgId}/skills`, token);

export const createSkill = (orgId: string, name: string, token: string) =>
  apiFetch<SkillDTO>(`/organizations/${orgId}/skills`, token, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const updateSkill = (skillId: string, name: string, token: string) =>
  apiFetch<SkillDTO>(`/skills/${skillId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteSkill = (skillId: string, token: string) =>
  apiFetch<void>(`/skills/${skillId}`, token, { method: "DELETE" });

// ── User skill assignment ───────────────────────────────────────────────────

export const fetchUserSkills = (userId: string, token: string) =>
  apiFetch<UserSkillDTO[]>(`/users/${userId}/skills`, token);

export const assignSkill = (userId: string, skillId: string, token: string) =>
  apiFetch<UserSkillDTO>(`/users/${userId}/skills/${skillId}`, token, { method: "POST" });

export const revokeSkill = (userId: string, skillId: string, token: string) =>
  apiFetch<void>(`/users/${userId}/skills/${skillId}`, token, { method: "DELETE" });

// ── StoreSkillDemand ─────────────────────────────────────────────────────────

export const fetchSkillDemand = (storeId: string, weekStart: string, token: string) =>
  apiFetch<StoreSkillDemandDTO[]>(`/stores/${storeId}/skill-demand/${weekStart}`, token);

export const setSkillDemand = (
  storeId: string,
  weekStart: string,
  body: { skill_id: string; slots: boolean[][] },
  token: string,
) =>
  apiFetch<StoreSkillDemandDTO>(`/stores/${storeId}/skill-demand/${weekStart}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const deleteSkillDemand = (
  storeId: string,
  weekStart: string,
  skillId: string,
  token: string,
) =>
  apiFetch<void>(`/stores/${storeId}/skill-demand/${weekStart}/${skillId}`, token, {
    method: "DELETE",
  });
