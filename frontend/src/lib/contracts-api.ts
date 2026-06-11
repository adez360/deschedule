import { apiFetch } from "@/lib/api-client";

export type ContractType = "FT" | "PT" | "CUSTOM";

export interface ContractDTO {
  id: string;
  user_id: string;
  contract_type: ContractType;
  monthly_salary: string | null; // Decimal serialised as string — FT only
  hourly_rate: string | null;    // Decimal serialised as string — PT only
  effective_from: string;        // "YYYY-MM-DD"
  effective_until: string | null;
  created_at: string;
}

export interface ContractSetBody {
  contract_type: ContractType;
  monthly_salary: string | null;
  hourly_rate: string | null;
  effective_from: string;
}

export const fetchActiveContract = (userId: string, token: string): Promise<ContractDTO | null> =>
  apiFetch<ContractDTO | null>(`/users/${userId}/contract`, token, { on404: "null" });

export const fetchUserContracts = (userId: string, token: string) =>
  apiFetch<ContractDTO[]>(`/users/${userId}/contracts`, token);

export const upsertContract = (userId: string, body: ContractSetBody, token: string) =>
  apiFetch<ContractDTO>(`/users/${userId}/contract`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
