"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, Loader2, Users, ChevronLeft, ChevronDown, ChevronRight,
  History, Wrench, Check, Search, UserRound, FileText, X, Building2,
  Star, ShieldCheck, CalendarClock, Clock, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchOrgUsers, fetchStores, type StoreDTO, type UserDTO } from "@/lib/schedules-api";
import { updateUser, setUserActive } from "@/lib/users-api";
import {
  fetchActiveContract, fetchUserContracts, upsertContract,
  type ContractDTO, type ContractType, type ContractSetBody,
} from "@/lib/contracts-api";
import {
  fetchSkills, fetchUserSkills, assignSkill, revokeSkill,
  type SkillDTO,
} from "@/lib/skills-api";
import { AvailabilityTab } from "./_components/availability-tab";
import { PreferencesTab } from "./_components/preferences-tab";
import { PermissionsTab } from "./_components/permissions-tab";
import { ScheduleHistoryTab } from "./_components/schedule-history-tab";
import { AddEmployeeDialog } from "./_components/add-employee-dialog";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTRACT_TYPES: { key: ContractType; label: string; desc: string }[] = [
  { key: "FT",     label: "全職",  desc: "Full-time"  },
  { key: "PT",     label: "兼職",  desc: "Part-time"  },
  { key: "CUSTOM", label: "自訂",  desc: "Custom"     },
];

const AVATAR_COLORS = [
  "rgba(124,58,237,0.6)", "rgba(37,99,235,0.6)", "rgba(5,150,105,0.6)",
  "rgba(217,119,6,0.6)",  "rgba(236,72,153,0.6)","rgba(8,145,178,0.6)",
];

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "name" | "hire_desc" | "hire_asc";
type GroupBy = "none" | "store" | "role" | "status";

const SORT_LABELS: Record<SortKey, string> = {
  name: "姓名", hire_desc: "入職日（新→舊）", hire_asc: "入職日（舊→新）",
};
const GROUP_LABELS: Record<GroupBy, string> = {
  none: "不分組", store: "依門市", role: "依身份組", status: "在職狀態",
};
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "全部", active: "在職", inactive: "停用",
};

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(s: string) {
  const [y, m, d] = s.split("-");
  return `${+m}/${+d}/${y}`;
}

const PIN_KEY = (orgId: string) => `employees:pinned:${orgId}`;

// ─── Form helpers ────────────────────────────────────────────────────────────

const defaultForm = (): ContractSetBody => ({
  contract_type: "PT",
  monthly_salary: null,
  hourly_rate: "",
  effective_from: toLocalDateStr(new Date()),
});

function formFromContract(c: ContractDTO): ContractSetBody {
  return {
    contract_type: c.contract_type,
    monthly_salary: c.monthly_salary,
    hourly_rate: c.hourly_rate,
    effective_from: c.effective_from,
  };
}

function withContractType(form: ContractSetBody, type: ContractType): ContractSetBody {
  if (type === "FT") return { ...form, contract_type: type, hourly_rate: null, monthly_salary: form.monthly_salary ?? "" };
  if (type === "PT") return { ...form, contract_type: type, monthly_salary: null, hourly_rate: form.hourly_rate ?? "" };
  return { ...form, contract_type: type, monthly_salary: null, hourly_rate: null };
}

// ─── Contract type badge ──────────────────────────────────────────────────────

function ContractBadge({ type }: { type: ContractType | null | undefined }) {
  if (!type) return null;
  const styles: Record<ContractType, string> = {
    FT:     "border-blue-500/30 bg-blue-600/15 text-blue-300",
    PT:     "border-green-500/30 bg-green-600/15 text-green-300",
    CUSTOM: "border-white/15 bg-white/8 text-white/50",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0", styles[type])}>
      {type}
    </span>
  );
}

// ─── Permission flags ─────────────────────────────────────────────────────────

interface PermFlags {
  manage: boolean;        // org.manage — role groups, create
  employeeManage: boolean; // org.employee.manage — status toggle
  availEdit: boolean;     // employee.availability.edit
  prefEdit: boolean;      // employee.preference.edit
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

type DetailUser = {
  id: string; name: string; nickname: string; email: string; idx: number;
  phone: string | null; avatar_url: string | null; note: string | null;
  hire_date: string | null; home_store_id: string | null;
  daily_hour_max: number | null; is_active: boolean;
};

function DetailPanel({
  user, token, orgId, orgSkills, stores, perms,
}: {
  user: DetailUser;
  token: string;
  orgId: string;
  orgSkills: SkillDTO[];
  stores: StoreDTO[];
  perms: PermFlags;
}) {
  const qc = useQueryClient();

  const [form, setForm] = useState<ContractSetBody>(defaultForm());
  const [showHistory, setShowHistory] = useState(false);
  const [homeStoreId, setHomeStoreId] = useState<string>(user.home_store_id ?? "");
  const [profile, setProfile] = useState({ nickname: "", phone: "", hire_date: "", note: "", avatar_url: "" });

  // ── Queries ─────────────────────────────────────────────────────────────

  const { data: activeContract, isLoading: contractLoading } = useQuery({
    queryKey: ["contract", user.id],
    queryFn: () => fetchActiveContract(user.id, token),
    enabled: !!user.id && !!token,
  });

  const { data: contractHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["contractHistory", user.id],
    queryFn: () => fetchUserContracts(user.id, token),
    enabled: !!user.id && !!token && showHistory,
  });

  const { data: userSkills = [], isLoading: userSkillsLoading } = useQuery({
    queryKey: ["userSkills", user.id],
    queryFn: () => fetchUserSkills(user.id, token),
    enabled: !!user.id && !!token,
  });

  const grantedSkillIds = useMemo(
    () => new Set(userSkills.map((us) => us.skill_id)),
    [userSkills],
  );

  useEffect(() => {
    if (activeContract) setForm(formFromContract(activeContract));
    else if (!contractLoading) setForm(defaultForm());
  }, [activeContract, contractLoading, user.id]);

  useEffect(() => {
    setHomeStoreId(user.home_store_id ?? "");
  }, [user.id, user.home_store_id]);

  useEffect(() => {
    setProfile({
      nickname: user.nickname ?? "",
      phone: user.phone ?? "",
      hire_date: user.hire_date ?? "",
      note: user.note ?? "",
      avatar_url: user.avatar_url ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const profileDirty =
    profile.nickname !== (user.nickname ?? "") ||
    profile.phone !== (user.phone ?? "") ||
    profile.hire_date !== (user.hire_date ?? "") ||
    profile.note !== (user.note ?? "") ||
    profile.avatar_url !== (user.avatar_url ?? "");

  const profileMut = useMutation({
    mutationFn: () =>
      updateUser(user.id, {
        nickname: profile.nickname || undefined,
        phone: profile.phone || null,
        hire_date: profile.hire_date || null,
        note: profile.note || null,
        avatar_url: profile.avatar_url || null,
      }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      toast.success("個人資料已更新");
    },
    onError: (e: Error) => toast.error(`更新失敗：${e.message}`),
  });

  const homeStoreMut = useMutation({
    mutationFn: (storeId: string | null) =>
      updateUser(user.id, { home_store_id: storeId }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      toast.success("已更新所屬門市");
    },
    onError: (e: Error) => toast.error(`更新失敗：${e.message}`),
  });

  const statusMut = useMutation({
    mutationFn: (active: boolean) => setUserActive(user.id, active, token),
    onSuccess: (_, active) => {
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      toast.success(active ? "已啟用員工" : "已停用員工");
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const isNew = !activeContract && !contractLoading;

  const saveMut = useMutation({
    mutationFn: () => upsertContract(user.id, form, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", user.id] });
      qc.invalidateQueries({ queryKey: ["contractHistory", user.id] });
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      toast.success(isNew ? "合約已建立" : "合約已更新");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const assignSkillMut = useMutation({
    mutationFn: (skillId: string) => assignSkill(user.id, skillId, token),
    onSuccess: (_, skillId) => {
      qc.invalidateQueries({ queryKey: ["userSkills", user.id] });
      const skill = orgSkills.find((s) => s.id === skillId);
      toast.success(`已賦予「${skill?.name ?? "技能"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const revokeSkillMut = useMutation({
    mutationFn: (skillId: string) => revokeSkill(user.id, skillId, token),
    onSuccess: (_, skillId) => {
      qc.invalidateQueries({ queryKey: ["userSkills", user.id] });
      const skill = orgSkills.find((s) => s.id === skillId);
      toast.success(`已移除「${skill?.name ?? "技能"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const toggleSkill = (skill: SkillDTO) => {
    if (grantedSkillIds.has(skill.id)) revokeSkillMut.mutate(skill.id);
    else assignSkillMut.mutate(skill.id);
  };

  const isValid =
    form.contract_type === "FT"
      ? form.monthly_salary !== null && form.monthly_salary !== "" && +form.monthly_salary > 0
      : form.contract_type === "PT"
      ? form.hourly_rate !== null && form.hourly_rate !== "" && +form.hourly_rate > 0
      : true;

  const avatarColor = AVATAR_COLORS[user.idx % AVATAR_COLORS.length];

  const tabTrigger = "flex items-center gap-1.5 rounded-lg h-8 px-2.5 text-xs text-white/40 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white transition-all";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Employee header */}
      <div className="flex items-center gap-3">
        <div
          className={cn("size-10 rounded-full flex-shrink-0 flex items-center justify-center text-base font-semibold text-white", !user.is_active && "grayscale opacity-60")}
          style={{ background: avatarColor }}
        >
          {user.name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white truncate">{user.name}</h2>
            {!user.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 bg-white/8 text-white/45 flex-shrink-0">停用</span>
            )}
          </div>
          <p className="text-xs text-white/40 truncate">{user.email}</p>
        </div>
        {/* Status toggle */}
        {perms.employeeManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={cn("text-xs", user.is_active ? "text-emerald-300/80" : "text-white/40")}>
              {user.is_active ? "在職" : "停用"}
            </span>
            <Switch
              checked={user.is_active}
              disabled={statusMut.isPending}
              onCheckedChange={(v) => statusMut.mutate(v)}
              aria-label="切換在職狀態"
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profile">
        <TabsList className="rounded-xl border border-white/[0.06] bg-white/[0.04] h-9 p-0.5 flex-wrap w-full justify-start gap-0.5">
          <TabsTrigger value="profile"  className={tabTrigger}><UserRound className="size-3" />個人資料</TabsTrigger>
          <TabsTrigger value="contract" className={tabTrigger}><FileText className="size-3" />合約</TabsTrigger>
          <TabsTrigger value="availability" className={tabTrigger}><Clock className="size-3" />可用時段</TabsTrigger>
          <TabsTrigger value="history"  className={tabTrigger}><CalendarClock className="size-3" />班表歷史</TabsTrigger>
          <TabsTrigger value="permissions" className={tabTrigger}><ShieldCheck className="size-3" />權限</TabsTrigger>
          <TabsTrigger value="skills"   className={tabTrigger}><Wrench className="size-3" />技能</TabsTrigger>
        </TabsList>

        {/* ── Tab: 個人資料 ── */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-white/10 p-5 space-y-4"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">姓名</label>
                <div className="h-10 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 flex items-center text-sm text-white/80">
                  {user.name}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">電子郵件</label>
                <div className="h-10 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 flex items-center text-sm text-white/80 font-mono text-xs">
                  {user.email}
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs text-white/40 flex items-center gap-1.5">
                  <Building2 className="size-3" /> 所屬門市
                </label>
                <div className="relative">
                  <select
                    value={homeStoreId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHomeStoreId(v);
                      homeStoreMut.mutate(v === "" ? null : v);
                    }}
                    disabled={homeStoreMut.isPending}
                    className="h-10 w-full appearance-none rounded-xl border border-white/10 bg-white/5 pl-3 pr-9 text-sm text-white focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors disabled:opacity-50"
                    style={{ colorScheme: "dark" }}
                  >
                    <option value="">（未設定）</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {homeStoreMut.isPending ? (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-white/40 animate-spin pointer-events-none" />
                  ) : (
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-white/30 pointer-events-none" />
                  )}
                </div>
                <p className="text-[11px] text-white/25">全職（FT）員工的月薪只計入所屬門市的薪資報表</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">暱稱</label>
                <input
                  value={profile.nickname}
                  onChange={(e) => setProfile((f) => ({ ...f, nickname: e.target.value }))}
                  placeholder="對所有人公開的顯示名稱"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">聯絡電話</label>
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="09XX-XXX-XXX"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">入職日期</label>
                <input
                  type="date"
                  value={profile.hire_date}
                  onChange={(e) => setProfile((f) => ({ ...f, hire_date: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                  style={{ colorScheme: "dark" }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">頭像連結</label>
                <input
                  value={profile.avatar_url}
                  onChange={(e) => setProfile((f) => ({ ...f, avatar_url: e.target.value }))}
                  placeholder="https://..."
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs text-white/40">備註（僅管理者可見）</label>
                <input
                  value={profile.note}
                  onChange={(e) => setProfile((f) => ({ ...f, note: e.target.value }))}
                  placeholder="內部備忘..."
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => profileMut.mutate()}
                disabled={!profileDirty || !profile.nickname.trim() || profileMut.isPending}
                className="h-9 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {profileMut.isPending && <Loader2 className="size-3.5 animate-spin" />}
                儲存個人資料
              </button>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 合約 ── */}
        <TabsContent value="contract" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-white/10 p-5 space-y-5"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white/70">
                {contractLoading ? "載入中..." : isNew ? "新增合約" : "編輯合約"}
              </h3>
              {!isNew && activeContract && (
                <span className="text-[10px] text-white/30">
                  生效自 {fmtDate(activeContract.effective_from)}
                </span>
              )}
            </div>

            {contractLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-xl bg-white/5" />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-xs text-white/40">合約類型</label>
                  <div className="flex gap-2 flex-wrap">
                    {CONTRACT_TYPES.map((ct) => (
                      <button
                        key={ct.key}
                        onClick={() => setForm((p) => withContractType(p, ct.key))}
                        className={cn(
                          "px-4 py-2 rounded-xl text-sm border transition-all",
                          form.contract_type === ct.key
                            ? "border-purple-500/60 bg-purple-600/25 text-white"
                            : "border-white/10 bg-white/5 text-white/40 hover:bg-white/8 hover:text-white/70",
                        )}
                      >
                        {ct.label}
                        <span className="ml-1.5 text-[10px] opacity-60">{ct.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {form.contract_type === "FT" && (
                  <div className="space-y-2">
                    <label className="text-xs text-white/40">月薪</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/40 flex-shrink-0">NT$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={500}
                        value={form.monthly_salary ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, monthly_salary: e.target.value }))}
                        placeholder="0"
                        className="h-10 w-40 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors [font-variant-numeric:tabular-nums]"
                      />
                      <span className="text-xs text-white/30">/ 月</span>
                    </div>
                    <p className="text-[11px] text-white/25">全職員工以固定月薪計算，不依時數計薪</p>
                  </div>
                )}

                {form.contract_type === "PT" && (
                  <div className="space-y-2">
                    <label className="text-xs text-white/40">時薪</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/40 flex-shrink-0">NT$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.5}
                        value={form.hourly_rate ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, hourly_rate: e.target.value }))}
                        placeholder="0.00"
                        className="h-10 w-36 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors [font-variant-numeric:tabular-nums]"
                      />
                      <span className="text-xs text-white/30">/ 小時</span>
                    </div>
                  </div>
                )}

                {form.contract_type === "CUSTOM" && (
                  <p className="text-[11px] text-white/25">自訂合約屬特殊人員，不需設定薪資項目</p>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-white/40">生效日期</label>
                  <input
                    type="date"
                    value={form.effective_from}
                    onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))}
                    className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                    style={{ colorScheme: "dark" }}
                  />
                  {!isNew && activeContract && form.effective_from !== activeContract.effective_from && (
                    <p className="text-[11px] text-yellow-400/70">
                      日期不同將建立新合約並結算舊合約（生效至 {form.effective_from} 前一天）
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <Button
            className="gap-2 border-0 text-white hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || contractLoading || !isValid}
          >
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isNew ? "建立合約" : "儲存合約"}
          </Button>

          <div className="rounded-2xl border border-white/10 overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="size-3.5" />
                <span>合約歷史</span>
              </div>
              {showHistory ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>

            {showHistory && (
              <div className="border-t border-white/10 px-5 py-4 space-y-2">
                {historyLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg bg-white/5" />
                  ))
                ) : contractHistory.length === 0 ? (
                  <p className="text-xs text-white/25">尚無合約記錄</p>
                ) : (
                  contractHistory.map((c) => (
                    <div key={c.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <ContractBadge type={c.contract_type} />
                        <span className="text-sm text-white/70 [font-variant-numeric:tabular-nums] flex-shrink-0">
                          {c.contract_type === "FT"
                            ? `NT$${c.monthly_salary}/月`
                            : c.contract_type === "PT"
                              ? `NT$${c.hourly_rate}/時`
                              : "—"}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/25 text-right flex-shrink-0">
                        <div>{fmtDate(c.effective_from)}</div>
                        <div>{c.effective_until ? `→ ${fmtDate(c.effective_until)}` : "→ 現在"}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: 可用時段（含門市偏好）── */}
        <TabsContent value="availability" className="mt-4 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-white/40" />
              <h3 className="text-sm font-medium text-white/70">可用時段</h3>
            </div>
            <AvailabilityTab userId={user.id} token={token} editable={perms.availEdit} />
          </div>
          <div className="space-y-3 border-t border-white/[0.07] pt-6">
            <div className="flex items-center gap-2">
              <Building2 className="size-3.5 text-white/40" />
              <h3 className="text-sm font-medium text-white/70">門市偏好</h3>
            </div>
            <PreferencesTab
              userId={user.id}
              token={token}
              storeList={stores}
              dailyHourMax={user.daily_hour_max}
              editable={perms.prefEdit}
            />
          </div>
        </TabsContent>

        {/* ── Tab: 班表歷史 ── */}
        <TabsContent value="history" className="mt-4">
          <ScheduleHistoryTab userId={user.id} token={token} stores={stores} />
        </TabsContent>

        {/* ── Tab: 權限 ── */}
        <TabsContent value="permissions" className="mt-4">
          <PermissionsTab userId={user.id} orgId={orgId} token={token} stores={stores} editable={perms.manage} />
        </TabsContent>

        {/* ── Tab: 技能 ── */}
        <TabsContent value="skills" className="mt-4">
          <div className="rounded-2xl border border-white/10 p-5 space-y-4"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
            <div className="flex items-center gap-2">
              <Wrench className="size-3.5 text-white/40" />
              <h3 className="text-sm font-medium text-white/70">工作能力</h3>
            </div>

            {orgSkills.length === 0 ? (
              <p className="text-[11px] text-white/25">組織尚未建立任何技能項目</p>
            ) : userSkillsLoading ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-24 rounded-xl bg-white/5" />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {orgSkills.map((skill) => {
                  const granted = grantedSkillIds.has(skill.id);
                  const pending =
                    (assignSkillMut.isPending && assignSkillMut.variables === skill.id) ||
                    (revokeSkillMut.isPending && revokeSkillMut.variables === skill.id);
                  return (
                    <button
                      key={skill.id}
                      onClick={() => toggleSkill(skill)}
                      disabled={pending}
                      className={cn(
                        "px-3.5 py-2 rounded-xl text-sm border transition-all flex items-center gap-1.5 disabled:opacity-50",
                        granted
                          ? "border-purple-500/50 bg-purple-600/20 text-white"
                          : "border-white/10 bg-white/5 text-white/40 hover:bg-white/8 hover:text-white/70",
                      )}
                    >
                      {pending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : granted ? (
                        <Check className="size-3.5" />
                      ) : null}
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-white/25">點擊技能標籤以賦予或移除該員工的工作能力</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── List grouping ────────────────────────────────────────────────────────────

interface Group { key: string; label: string; users: UserDTO[] }

function buildGroups(
  users: UserDTO[],
  groupBy: GroupBy,
  storeName: Map<string, string>,
): Group[] {
  if (groupBy === "none") return [{ key: "all", label: "", users }];

  if (groupBy === "status") {
    const active = users.filter((u) => u.is_active !== false);
    const inactive = users.filter((u) => u.is_active === false);
    return [
      ...(active.length ? [{ key: "active", label: "在職", users: active }] : []),
      ...(inactive.length ? [{ key: "inactive", label: "停用", users: inactive }] : []),
    ];
  }

  if (groupBy === "store") {
    const map = new Map<string, UserDTO[]>();
    for (const u of users) {
      const k = u.home_store_id ?? "__none__";
      (map.get(k) ?? map.set(k, []).get(k)!).push(u);
    }
    const groups: Group[] = [];
    for (const [k, list] of map) {
      if (k === "__none__") continue;
      groups.push({ key: k, label: storeName.get(k) ?? "未知門市", users: list });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
    if (map.has("__none__")) groups.push({ key: "__none__", label: "未設定門市", users: map.get("__none__")! });
    return groups;
  }

  // role
  const map = new Map<string, { label: string; users: UserDTO[] }>();
  const none: UserDTO[] = [];
  for (const u of users) {
    const rgs = u.role_groups ?? [];
    if (rgs.length === 0) { none.push(u); continue; }
    for (const rg of rgs) {
      const entry = map.get(rg.id) ?? { label: rg.name, users: [] };
      entry.users.push(u);
      map.set(rg.id, entry);
    }
  }
  const groups: Group[] = Array.from(map.entries())
    .map(([k, v]) => ({ key: k, label: v.label, users: v.users }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (none.length) groups.push({ key: "__none__", label: "未指派身份組", users: none });
  return groups;
}

// ─── Employee row ─────────────────────────────────────────────────────────────

function EmployeeRow({
  user, idx, isActive, isSelected, isPinned, onSelect, onToggleCheck, onTogglePin,
}: {
  user: UserDTO;
  idx: number;
  isActive: boolean;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onToggleCheck: (e: React.MouseEvent) => void;
  onTogglePin: (e: React.MouseEvent) => void;
}) {
  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const inactive = user.is_active === false;
  return (
    <div
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border text-left px-3 py-2.5 transition-all flex items-center gap-3 group cursor-pointer",
        isActive
          ? "border-purple-500/50 bg-purple-600/15"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
        inactive && "opacity-55",
      )}
    >
      <div
        onClick={onToggleCheck}
        className={cn(
          "size-4 rounded flex-shrink-0 flex items-center justify-center border transition-all cursor-pointer",
          isSelected ? "border-purple-500 bg-purple-600" : "border-white/20 bg-transparent group-hover:border-white/40",
        )}
      >
        {isSelected && <Check className="size-2.5 text-white" strokeWidth={3} />}
      </div>

      <div
        className={cn("size-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white", inactive && "grayscale")}
        style={{ background: avatarColor }}
      >
        {user.name[0]}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-white truncate">{user.name}</p>
          <ContractBadge type={user.contract_type} />
        </div>
        <p className="text-[11px] text-white/30 truncate">{user.email}</p>
      </div>

      <button
        onClick={onTogglePin}
        aria-label={isPinned ? "取消釘選" : "釘選"}
        className={cn(
          "flex-shrink-0 rounded-md p-1 transition-all",
          isPinned ? "text-amber-400" : "text-white/15 hover:text-white/50 opacity-0 group-hover:opacity-100",
        )}
      >
        <Star className="size-3.5" fill={isPinned ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";

  const perms: PermFlags = useMemo(() => {
    const set = new Set<string>(session?.user?.role_groups?.flatMap((rg) => rg.permissions) ?? []);
    const has = (p: string) => set.has(p) || set.has("system.all");
    return {
      manage: has("org.manage"),
      employeeManage: has("org.employee.manage"),
      availEdit: has("employee.availability.edit"),
      prefEdit: has("employee.preference.edit"),
    };
  }, [session?.user?.role_groups]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters / sort / group
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [contractFilter, setContractFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  // Pins (localStorage)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = localStorage.getItem(PIN_KEY(orgId));
      if (raw) setPinnedIds(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, [orgId]);
  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (orgId) localStorage.setItem(PIN_KEY(orgId), JSON.stringify([...next]));
      return next;
    });
  }, [orgId]);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: orgUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: orgSkills = [] } = useQuery({
    queryKey: ["orgSkills"],
    queryFn: () => fetchSkills(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  // ── Derived: filter → sort → (pin partition) → group ────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgUsers.filter((u) => {
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)
        && !(u.nickname ?? "").toLowerCase().includes(q)) return false;
      if (statusFilter === "active" && u.is_active === false) return false;
      if (statusFilter === "inactive" && u.is_active !== false) return false;
      if (storeFilter !== "all") {
        if (storeFilter === "__none__" ? u.home_store_id != null : u.home_store_id !== storeFilter) return false;
      }
      if (contractFilter !== "all") {
        if (contractFilter === "__none__" ? u.contract_type != null : u.contract_type !== contractFilter) return false;
      }
      return true;
    });
  }, [orgUsers, search, statusFilter, storeFilter, contractFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      const ah = a.hire_date ?? "", bh = b.hire_date ?? "";
      if (sortKey === "hire_desc") return (bh || "0").localeCompare(ah || "0");
      return (ah || "9999").localeCompare(bh || "9999");
    });
    return arr;
  }, [filtered, sortKey]);

  const pinned = useMemo(() => sorted.filter((u) => pinnedIds.has(u.id)), [sorted, pinnedIds]);
  const rest = useMemo(() => sorted.filter((u) => !pinnedIds.has(u.id)), [sorted, pinnedIds]);

  const groups = useMemo(() => buildGroups(rest, groupBy, storeName), [rest, groupBy, storeName]);

  const userIndex = useMemo(() => new Map(orgUsers.map((u, i) => [u.id, i])), [orgUsers]);

  const panelOpen = selectedUserId !== null;
  const selectedUser = orgUsers.find((u) => u.id === selectedUserId);

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (storeFilter !== "all" ? 1 : 0) +
    (contractFilter !== "all" ? 1 : 0) +
    (sortKey !== "name" ? 1 : 0) +
    (groupBy !== "none" ? 1 : 0);

  const resetControls = () => {
    setStatusFilter("all"); setStoreFilter("all"); setContractFilter("all");
    setSortKey("name"); setGroupBy("none");
  };

  // ── Multi-select helpers ──────────────────────────────────────────────────

  const toggleSelect = useCallback((userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedIds(new Set(sorted.map((u) => u.id)));
  const clearSelected = () => setSelectedIds(new Set());

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderRow = (user: UserDTO) => (
    <EmployeeRow
      key={user.id}
      user={user}
      idx={userIndex.get(user.id) ?? 0}
      isActive={selectedUserId === user.id}
      isSelected={selectedIds.has(user.id)}
      isPinned={pinnedIds.has(user.id)}
      onSelect={() => setSelectedUserId(user.id)}
      onToggleCheck={(e) => toggleSelect(user.id, e)}
      onTogglePin={(e) => { e.stopPropagation(); togglePin(user.id); }}
    />
  );

  const selectCls = "h-9 appearance-none rounded-lg border border-white/10 bg-white/5 pl-3 pr-8 text-sm text-white focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">員工管理</h1>
          <p className="mt-1 text-sm text-white/40">管理員工資料、合約、可用時段、班表與權限</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">

        {/* ── Left: employee list ── */}
        <div className={cn("flex flex-col gap-3", panelOpen && "hidden lg:flex")}>

          {/* Search + add */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/30 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋姓名 / 暱稱 / Email..."
                className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
              />
            </div>
            {perms.manage && (
              <AddEmployeeDialog orgId={orgId} token={token} onCreated={(id) => setSelectedUserId(id)} />
            )}
          </div>

          {/* Filter / sort / group popover */}
          <div className="flex items-center justify-between gap-2">
            <Popover>
              <PopoverTrigger
                render={<button className="h-9 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white/60 hover:bg-white/8 hover:text-white/80 transition-colors" />}
              >
                <SlidersHorizontal className="size-3.5" />
                篩選與檢視
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-purple-600/70 px-1.5 text-[10px] font-medium text-white">{activeFilterCount}</span>
                )}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 border-white/10 bg-[#15151f] text-white p-4 space-y-4">
                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">在職狀態</label>
                  <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                    {(["all", "active", "inactive"] as StatusFilter[]).map((s) => (
                      <button key={s} onClick={() => setStatusFilter(s)}
                        className={cn("flex-1 rounded-md py-1 text-xs transition-all",
                          statusFilter === s ? "bg-purple-600/40 text-white" : "text-white/40 hover:text-white/70")}>
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Store */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">所屬門市</label>
                  <div className="relative">
                    <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className={cn(selectCls, "w-full")} style={{ colorScheme: "dark" }}>
                      <option value="all">全部門市</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="__none__">未設定</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30 pointer-events-none" />
                  </div>
                </div>
                {/* Contract */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">合約類型</label>
                  <div className="relative">
                    <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} className={cn(selectCls, "w-full")} style={{ colorScheme: "dark" }}>
                      <option value="all">全部類型</option>
                      {CONTRACT_TYPES.map((c) => <option key={c.key} value={c.key}>{c.label}（{c.key}）</option>)}
                      <option value="__none__">未設定</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30 pointer-events-none" />
                  </div>
                </div>
                {/* Sort */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">排序</label>
                  <div className="relative">
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={cn(selectCls, "w-full")} style={{ colorScheme: "dark" }}>
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30 pointer-events-none" />
                  </div>
                </div>
                {/* Group */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">分組檢視</label>
                  <div className="relative">
                    <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={cn(selectCls, "w-full")} style={{ colorScheme: "dark" }}>
                      {(Object.keys(GROUP_LABELS) as GroupBy[]).map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30 pointer-events-none" />
                  </div>
                </div>
                {activeFilterCount > 0 && (
                  <button onClick={resetControls} className="w-full rounded-lg border border-white/10 py-1.5 text-xs text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors">
                    重設全部
                  </button>
                )}
              </PopoverContent>
            </Popover>

            <span className="text-xs text-white/30 flex-shrink-0">{sorted.length} 位</span>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {statusFilter !== "all" && (
                <FilterChip label={`狀態：${STATUS_LABELS[statusFilter]}`} onClear={() => setStatusFilter("all")} />
              )}
              {storeFilter !== "all" && (
                <FilterChip label={`門市：${storeFilter === "__none__" ? "未設定" : storeName.get(storeFilter) ?? "—"}`} onClear={() => setStoreFilter("all")} />
              )}
              {contractFilter !== "all" && (
                <FilterChip label={`合約：${contractFilter === "__none__" ? "未設定" : contractFilter}`} onClear={() => setContractFilter("all")} />
              )}
              {sortKey !== "name" && <FilterChip label={`排序：${SORT_LABELS[sortKey]}`} onClear={() => setSortKey("name")} />}
              {groupBy !== "none" && <FilterChip label={`分組：${GROUP_LABELS[groupBy]}`} onClear={() => setGroupBy("none")} />}
            </div>
          )}

          {/* Bulk selection bar (multi-select; batch actions TBD) */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-600/10 px-3.5 py-2.5">
              <span className="text-xs text-purple-300">已選 {selectedIds.size} 位</span>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-xs text-white/50 hover:text-white/80 transition-colors">全選</button>
                <span className="text-white/20">·</span>
                <button onClick={clearSelected} className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
                  <X className="size-3" />取消
                </button>
              </div>
            </div>
          )}

          {/* Employee list (grouped) */}
          <div className="space-y-3 overflow-y-auto pr-0.5" style={{ maxHeight: "calc(100vh - 320px)" }}>
            {usersLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/5" />
              ))
            ) : sorted.length === 0 ? (
              <div className="rounded-2xl border border-white/10 p-8 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                <Users className="mx-auto size-8 text-white/20 mb-3" />
                <p className="text-sm text-white/30">
                  {search.trim() || activeFilterCount ? "找不到符合條件的員工" : "組織中尚無員工"}
                </p>
              </div>
            ) : (
              <>
                {/* Pinned group */}
                {pinned.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 px-1">
                      <Star className="size-3 text-amber-400" fill="currentColor" />
                      <span className="text-[11px] font-medium text-white/40">釘選</span>
                      <span className="text-[10px] text-white/25">{pinned.length}</span>
                    </div>
                    {pinned.map(renderRow)}
                  </div>
                )}
                {/* Grouped rest */}
                {groups.map((g) => (
                  <div key={g.key} className="space-y-1.5">
                    {g.label && (
                      <div className="flex items-center gap-1.5 px-1">
                        <span className="text-[11px] font-medium text-white/40">{g.label}</span>
                        <span className="text-[10px] text-white/25">{g.users.length}</span>
                      </div>
                    )}
                    {g.users.map(renderRow)}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right: detail panel ── */}
        {panelOpen && selectedUser ? (
          <div>
            <button
              className="lg:hidden flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-5"
              onClick={() => setSelectedUserId(null)}
            >
              <ChevronLeft className="size-4" />返回清單
            </button>

            <DetailPanel
              user={{
                id: selectedUser.id,
                name: selectedUser.name,
                nickname: selectedUser.nickname ?? selectedUser.name,
                email: selectedUser.email,
                idx: userIndex.get(selectedUser.id) ?? 0,
                phone: selectedUser.phone ?? null,
                avatar_url: selectedUser.avatar_url ?? null,
                note: selectedUser.note ?? null,
                hire_date: selectedUser.hire_date ?? null,
                home_store_id: selectedUser.home_store_id ?? null,
                daily_hour_max: selectedUser.daily_hour_max ?? null,
                is_active: selectedUser.is_active !== false,
              }}
              token={token}
              orgId={orgId}
              orgSkills={orgSkills}
              stores={stores}
              perms={perms}
            />
          </div>
        ) : (
          <div className="hidden lg:flex items-center justify-center rounded-2xl border border-white/10 min-h-[400px]"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="text-center">
              <Users className="mx-auto size-10 text-white/15 mb-3" />
              <p className="text-sm text-white/30">選擇左側員工以查看或編輯</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-600/10 pl-2.5 pr-1.5 py-0.5 text-[11px] text-purple-200">
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 hover:bg-white/10 transition-colors" aria-label="移除篩選">
        <X className="size-2.5" />
      </button>
    </span>
  );
}
