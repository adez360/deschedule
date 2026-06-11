"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, Loader2, Users, ChevronLeft, ChevronDown, ChevronRight,
  History, Wrench, Check, Search, UserRound, FileText, X, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchOrgUsers, fetchStores, type StoreDTO } from "@/lib/schedules-api";
import { updateUser } from "@/lib/users-api";
import {
  fetchActiveContract, fetchUserContracts, upsertContract,
  type ContractDTO, type ContractType, type ContractSetBody,
} from "@/lib/contracts-api";
import {
  fetchSkills, fetchUserSkills, assignSkill, revokeSkill,
  type SkillDTO,
} from "@/lib/skills-api";

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

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(s: string) {
  const [y, m, d] = s.split("-");
  return `${+m}/${+d}/${y}`;
}

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

// ─── Contract type badge (small, used in list) ───────────────────────────────

function ContractBadge({ type }: { type: ContractType | undefined }) {
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

// ─── Detail Panel ────────────────────────────────────────────────────────────

type DetailUser = {
  id: string; name: string; nickname: string; email: string; idx: number;
  phone: string | null; avatar_url: string | null; note: string | null;
  hire_date: string | null; home_store_id: string | null;
};

function DetailPanel({
  user, token, orgSkills, stores,
}: {
  user: DetailUser;
  token: string;
  orgSkills: SkillDTO[];
  stores: StoreDTO[];
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

  // Sync form when contract loads / user changes
  useEffect(() => {
    if (activeContract) setForm(formFromContract(activeContract));
    else if (!contractLoading) setForm(defaultForm());
  }, [activeContract, contractLoading, user.id]);

  // Sync home store when switching employees
  useEffect(() => {
    setHomeStoreId(user.home_store_id ?? "");
  }, [user.id, user.home_store_id]);

  // Sync profile form when switching employees
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

  // ── Mutations ────────────────────────────────────────────────────────────

  const isNew = !activeContract && !contractLoading;

  const saveMut = useMutation({
    mutationFn: () => upsertContract(user.id, form, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", user.id] });
      qc.invalidateQueries({ queryKey: ["contractHistory", user.id] });
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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Employee header */}
      <div className="flex items-center gap-3">
        <div
          className="size-10 rounded-full flex-shrink-0 flex items-center justify-center text-base font-semibold text-white"
          style={{ background: avatarColor }}
        >
          {user.name[0]}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white truncate">{user.name}</h2>
          <p className="text-xs text-white/40 truncate">{user.email}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="contract">
        <TabsList className="rounded-xl border border-white/[0.06] bg-white/[0.04] h-9 p-0.5">
          {[
            { value: "profile",  label: "個人資料", icon: UserRound },
            { value: "contract", label: "合約",     icon: FileText  },
            { value: "skills",   label: "技能",     icon: Wrench    },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="flex items-center gap-1.5 rounded-lg h-8 px-3 text-xs text-white/40 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white transition-all"
            >
              <Icon className="size-3" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Tab: 個人資料 ── */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-white/10 p-5 space-y-4"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Read-only fields */}
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
              {/* 所屬門市 (functional) — FT monthly salary is attributed here */}
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
              {/* Editable profile fields */}
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

          {/* Contract history (collapsible) */}
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return orgUsers;
    const q = search.toLowerCase();
    return orgUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [orgUsers, search]);

  const panelOpen = selectedUserId !== null;
  const selectedUser = orgUsers.find((u) => u.id === selectedUserId);

  // ── Multi-select helpers ──────────────────────────────────────────────────

  const toggleSelect = useCallback((userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const selectAll  = () => setSelectedIds(new Set(filteredUsers.map((u) => u.id)));
  const clearSelected = () => setSelectedIds(new Set());

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">員工管理</h1>
        <p className="mt-1 text-sm text-white/40">管理員工合約、薪資與工作能力</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">

        {/* ── Left: employee list ── */}
        <div className={cn("flex flex-col gap-3", panelOpen && "hidden lg:flex")}>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/30 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋員工..."
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-600/10 px-3.5 py-2.5">
              <span className="text-xs text-purple-300">
                已選 {selectedIds.size} 位
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  全選
                </button>
                <span className="text-white/20">·</span>
                <button
                  onClick={clearSelected}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1"
                >
                  <X className="size-3" />取消
                </button>
              </div>
            </div>
          )}

          {/* Employee list */}
          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
            {usersLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/5" />
              ))
            ) : filteredUsers.length === 0 ? (
              <div className="rounded-2xl border border-white/10 p-8 text-center"
                style={{ background: "rgba(255,255,255,0.03)" }}>
                <Users className="mx-auto size-8 text-white/20 mb-3" />
                <p className="text-sm text-white/30">
                  {search.trim() ? "找不到符合員工" : "組織中尚無員工"}
                </p>
              </div>
            ) : (
              filteredUsers.map((user, i) => {
                const isSelected  = selectedIds.has(user.id);
                const isActive    = selectedUserId === user.id;
                const avatarColor = AVATAR_COLORS[orgUsers.findIndex((u) => u.id === user.id) % AVATAR_COLORS.length];

                return (
                  <button
                    key={user.id}
                    onClick={() => { setSelectedUserId(user.id); }}
                    className={cn(
                      "w-full rounded-xl border text-left px-3 py-3 transition-all flex items-center gap-3 group",
                      isActive
                        ? "border-purple-500/50 bg-purple-600/15"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                    )}
                  >
                    {/* Checkbox */}
                    <div
                      onClick={(e) => toggleSelect(user.id, e)}
                      className={cn(
                        "size-4 rounded flex-shrink-0 flex items-center justify-center border transition-all cursor-pointer",
                        isSelected
                          ? "border-purple-500 bg-purple-600"
                          : "border-white/20 bg-transparent group-hover:border-white/40",
                      )}
                    >
                      {isSelected && <Check className="size-2.5 text-white" strokeWidth={3} />}
                    </div>

                    {/* Avatar */}
                    <div
                      className="size-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white"
                      style={{ background: avatarColor }}
                    >
                      {user.name[0]}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{user.name}</p>
                      <p className="text-[11px] text-white/30 truncate">{user.email}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: detail panel ── */}
        {panelOpen && selectedUser ? (
          <div>
            {/* Mobile back */}
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
                idx: orgUsers.findIndex((u) => u.id === selectedUser.id),
                phone: selectedUser.phone ?? null,
                avatar_url: selectedUser.avatar_url ?? null,
                note: selectedUser.note ?? null,
                hire_date: selectedUser.hire_date ?? null,
                home_store_id: selectedUser.home_store_id ?? null,
              }}
              token={token}
              orgSkills={orgSkills}
              stores={stores}
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
