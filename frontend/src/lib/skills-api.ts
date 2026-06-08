const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });
const check = async (r: Response) => { if (!r.ok) throw new Error(`${r.status}`); };

// ── Skill CRUD (org-level) ──────────────────────────────────────────────────

export const fetchSkills = (orgId: string, token: string): Promise<SkillDTO[]> =>
  fetch(`${API}/api/organizations/${orgId}/skills`, { headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const createSkill = (orgId: string, name: string, token: string): Promise<SkillDTO> =>
  fetch(`${API}/api/organizations/${orgId}/skills`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify({ name }),
  }).then(async r => { await check(r); return r.json(); });

export const updateSkill = (skillId: string, name: string, token: string): Promise<SkillDTO> =>
  fetch(`${API}/api/skills/${skillId}`, {
    method: "PATCH",
    headers: json(token),
    body: JSON.stringify({ name }),
  }).then(async r => { await check(r); return r.json(); });

export const deleteSkill = (skillId: string, token: string): Promise<void> =>
  fetch(`${API}/api/skills/${skillId}`, { method: "DELETE", headers: auth(token) })
    .then(async r => { await check(r); });

// ── User skill assignment ───────────────────────────────────────────────────

export const fetchUserSkills = (userId: string, token: string): Promise<UserSkillDTO[]> =>
  fetch(`${API}/api/users/${userId}/skills`, { headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const assignSkill = (userId: string, skillId: string, token: string): Promise<UserSkillDTO> =>
  fetch(`${API}/api/users/${userId}/skills/${skillId}`, { method: "POST", headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const revokeSkill = (userId: string, skillId: string, token: string): Promise<void> =>
  fetch(`${API}/api/users/${userId}/skills/${skillId}`, { method: "DELETE", headers: auth(token) })
    .then(async r => { await check(r); });

// ── StoreSkillDemand ─────────────────────────────────────────────────────────

export const fetchSkillDemand = (
  storeId: string, weekStart: string, token: string,
): Promise<StoreSkillDemandDTO[]> =>
  fetch(`${API}/api/stores/${storeId}/skill-demand/${weekStart}`, { headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const setSkillDemand = (
  storeId: string, weekStart: string, body: { skill_id: string; slots: boolean[][] }, token: string,
): Promise<StoreSkillDemandDTO> =>
  fetch(`${API}/api/stores/${storeId}/skill-demand/${weekStart}`, {
    method: "PUT",
    headers: json(token),
    body: JSON.stringify(body),
  }).then(async r => { await check(r); return r.json(); });

export const deleteSkillDemand = (
  storeId: string, weekStart: string, skillId: string, token: string,
): Promise<void> =>
  fetch(`${API}/api/stores/${storeId}/skill-demand/${weekStart}/${skillId}`, {
    method: "DELETE",
    headers: auth(token),
  }).then(async r => { await check(r); });
