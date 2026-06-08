export type Permission =
  | "system.all"
  | "org.manage"
  | "org.schedule.view_all"
  | "org.schedule.arrange"
  | "org.employee.manage"
  | "store.schedule.view"
  | "store.schedule.edit"
  | "store.demand.edit"
  | "store.schedule.deadline.manage"
  | "self.schedule.view"
  | "self.availability.edit"
  | "self.preference.edit"
  | "self.profile.edit"
  | "employee.availability.edit"
  | "employee.preference.edit"
  | "employee.payroll.view"
  | "employee.contract.edit";

export interface RoleGroupSummary {
  id: string;
  name: string;
  store_ids: string[];
  permissions: Permission[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  organization_id: string;
  role_groups: RoleGroupSummary[];
  is_active: boolean;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

export interface Store {
  id: string;
  organization_id: string;
  name: string;
  address: string;
  timezone: string;
  created_at: string;
}

export interface RoleGroup {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string;
  permissions: Permission[];
}

export type ContractType = "FT" | "PT" | "custom";

export interface EmployeeContract {
  id: string;
  user_id: string;
  store_id: string;
  contract_type: ContractType;
  monthly_salary: number | null; // FT only
  hourly_rate: number | null; // PT only
  effective_from: string;
  effective_until: string | null;
  created_at: string;
}

export interface StorePreference {
  id: string;
  user_id: string;
  store_id: string;
  weight: number;
}

/** slots[day][hour] — day 0 = Monday, hour 0 = 00:00 */
export type AvailabilitySlots = boolean[][];

export interface Availability {
  id: string;
  user_id: string;
  week_start: string;
  slots: AvailabilitySlots;
  is_default_template: boolean;
  locked: boolean;
  updated_at: string;
}

/** slots[day][hour] — required headcount per slot */
export type DemandSlots = number[][];

export interface DemandTemplate {
  id: string;
  store_id: string;
  week_start: string;
  slots: DemandSlots;
  updated_at: string;
}

export interface ScheduleDeadlineConfig {
  id: string;
  store_id: string;
  days_before_week_start: number;
  deadline_time: string;
  updated_at: string;
}

export type ScheduleStatus = "draft" | "published" | "archived";

export interface Schedule {
  id: string;
  store_id: string;
  week_start: string;
  status: ScheduleStatus;
  generated_at: string;
  published_at: string | null;
  assignments: Assignment[];
}

export interface Assignment {
  id: string;
  schedule_id: string;
  user_id: string;
  store_id: string;
  day: number;
  hour: number;
  is_manual: boolean;
  created_at: string;
}

export interface PayrollReport {
  id: string;
  user_id: string;
  store_id: string;
  week_start: string;
  total_hours: number;
  contract_type: ContractType;
  monthly_salary_snapshot: number | null; // FT only
  hourly_rate_snapshot: number | null; // PT only
  gross_pay: number;
  currency: string;
  generated_at: string;
  note: string | null;
}
