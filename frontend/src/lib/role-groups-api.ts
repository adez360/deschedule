const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface RoleGroupDTO {
  id: string;
  organization_id: string | null;
  store_ids: string[];
  name: string;
  permissions: string[];
}

export interface UserRoleGroupDTO {
  user_id: string;
  role_group_id: string;
  granted_at: string;
  role_group: RoleGroupDTO;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });
const check = async (r: Response) => { if (!r.ok) throw new Error(`${r.status}`); };

export const fetchRoleGroups = (orgId: string, token: string): Promise<RoleGroupDTO[]> =>
  fetch(`${API}/api/organizations/${orgId}/role-groups`, { headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const createRoleGroup = (
  orgId: string,
  body: { name: string; store_ids: string[]; permissions: string[] },
  token: string,
): Promise<RoleGroupDTO> =>
  fetch(`${API}/api/organizations/${orgId}/role-groups`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify(body),
  }).then(async r => { await check(r); return r.json(); });

export const updateRoleGroup = (
  roleGroupId: string,
  body: { name?: string; store_ids?: string[]; permissions?: string[] },
  token: string,
): Promise<RoleGroupDTO> =>
  fetch(`${API}/api/role-groups/${roleGroupId}`, {
    method: "PATCH",
    headers: json(token),
    body: JSON.stringify(body),
  }).then(async r => { await check(r); return r.json(); });

export const deleteRoleGroup = (roleGroupId: string, token: string): Promise<void> =>
  fetch(`${API}/api/role-groups/${roleGroupId}`, {
    method: "DELETE",
    headers: auth(token),
  }).then(async r => { await check(r); });

export const fetchUserRoleGroups = (userId: string, token: string): Promise<UserRoleGroupDTO[]> =>
  fetch(`${API}/api/users/${userId}/role-groups`, { headers: auth(token) })
    .then(async r => { await check(r); return r.json(); });

export const assignRoleGroup = (userId: string, roleGroupId: string, token: string): Promise<UserRoleGroupDTO> =>
  fetch(`${API}/api/users/${userId}/role-groups/${roleGroupId}`, {
    method: "POST",
    headers: auth(token),
  }).then(async r => { await check(r); return r.json(); });

export const revokeRoleGroup = (userId: string, roleGroupId: string, token: string): Promise<void> =>
  fetch(`${API}/api/users/${userId}/role-groups/${roleGroupId}`, {
    method: "DELETE",
    headers: auth(token),
  }).then(async r => { await check(r); });
