import { apiFetch } from "@/lib/api-client";

export interface PayrollReportDTO {
  id: string;
  user_id: string;
  user_name: string;
  store_id: string;
  store_name: string;
  home_store_id: string | null;   // FT monthly salary is attributed only to this store
  week_start: string;              // "YYYY-MM-DD"
  total_hours: string;             // Decimal serialised as string
  contract_type: "FT" | "PT" | "CUSTOM";
  monthly_salary_snapshot: string | null;
  hourly_rate_snapshot: string | null;
  gross_pay: string | null;        // null for CUSTOM
  currency: string;
  generated_at: string;
  note: string | null;
}

export interface PayrollAdjustmentDTO {
  id: string;
  user_id: string;
  year: number;
  month: number;
  label: string;
  amount: string;                  // Decimal serialised as string, signed (+/-)
  currency: string;
  created_at: string;
}

export interface GenerateResult {
  generated: number;
  weeks: string[];
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export const fetchOrgPayroll = (orgId: string, year: number, month: number, token: string) =>
  apiFetch<PayrollReportDTO[]>(
    `/organizations/${orgId}/payroll?year=${year}&month=${month}`,
    token,
  );

export const fetchStorePayroll = (storeId: string, year: number, month: number, token: string) =>
  apiFetch<PayrollReportDTO[]>(
    `/stores/${storeId}/payroll?year=${year}&month=${month}`,
    token,
  );

export const fetchMyPayroll = (year: number, month: number, token: string) =>
  apiFetch<PayrollReportDTO[]>(`/users/me/payroll?year=${year}&month=${month}`, token);

export const fetchUserPayroll = (
  userId: string, year: number, month: number, token: string,
) =>
  apiFetch<PayrollReportDTO[]>(
    `/users/${userId}/payroll?year=${year}&month=${month}`,
    token,
  );

export const generatePayroll = (storeId: string, year: number, month: number, token: string) =>
  apiFetch<GenerateResult>(`/stores/${storeId}/payroll/generate`, token, {
    method: "POST",
    body: JSON.stringify({ year, month }),
  });

// ─── Adjustments (其他項目) ────────────────────────────────────────────────────

export const fetchAdjustments = (
  userId: string, year: number, month: number, token: string,
) =>
  apiFetch<PayrollAdjustmentDTO[]>(
    `/users/${userId}/payroll-adjustments?year=${year}&month=${month}`,
    token,
  );

export const createAdjustment = (
  userId: string,
  body: { year: number; month: number; label: string; amount: string },
  token: string,
) =>
  apiFetch<PayrollAdjustmentDTO>(`/users/${userId}/payroll-adjustments`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateAdjustment = (
  adjustmentId: string,
  body: { label?: string; amount?: string },
  token: string,
) =>
  apiFetch<PayrollAdjustmentDTO>(`/payroll-adjustments/${adjustmentId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteAdjustment = (adjustmentId: string, token: string) =>
  apiFetch<void>(`/payroll-adjustments/${adjustmentId}`, token, { method: "DELETE" });
