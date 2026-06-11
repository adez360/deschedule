import { apiFetch } from "@/lib/api-client";

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

export const fetchRoleGroups = (orgId: string, token: string) =>
  apiFetch<RoleGroupDTO[]>(`/organizations/${orgId}/role-groups`, token);

export const createRoleGroup = (
  orgId: string,
  body: { name: string; store_ids: string[]; permissions: string[] },
  token: string,
) =>
  apiFetch<RoleGroupDTO>(`/organizations/${orgId}/role-groups`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateRoleGroup = (
  roleGroupId: string,
  body: { name?: string; store_ids?: string[]; permissions?: string[] },
  token: string,
) =>
  apiFetch<RoleGroupDTO>(`/role-groups/${roleGroupId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteRoleGroup = (roleGroupId: string, token: string) =>
  apiFetch<void>(`/role-groups/${roleGroupId}`, token, { method: "DELETE" });

export const fetchUserRoleGroups = (userId: string, token: string) =>
  apiFetch<UserRoleGroupDTO[]>(`/users/${userId}/role-groups`, token);

export const assignRoleGroup = (userId: string, roleGroupId: string, token: string) =>
  apiFetch<UserRoleGroupDTO>(`/users/${userId}/role-groups/${roleGroupId}`, token, {
    method: "POST",
  });

export const revokeRoleGroup = (userId: string, roleGroupId: string, token: string) =>
  apiFetch<void>(`/users/${userId}/role-groups/${roleGroupId}`, token, { method: "DELETE" });
