"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, Users, ChevronLeft, ChevronDown, ChevronRight, History, Wrench, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores, fetchOrgUsers } from "@/lib/schedules-api";
import {
  fetchActiveContract, fetchUserContracts, upsertContract,
  type ContractDTO, type ContractType, type ContractSetBody,
} from "@/lib/contracts-api";
import {
  fetchSkills, fetchUserSkills, assignSkill, revokeSkill,
  type SkillDTO,
} from "@/lib/skills-api";

// ─── Constants ─────────────────────────────────────────────────────────────

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

// ─── Contract form state ────────────────────────────────────────────────────

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

/** Switching contract type clears the pay-term field that no longer applies. */
function withContractType(form: ContractSetBody, type: ContractType): ContractSetBody {
  if (type === "FT") return { ...form, contract_type: type, hourly_rate: null, monthly_salary: form.monthly_salary ?? "" };
  if (type === "PT") return { ...form, contract_type: type, monthly_salary: null, hourly_rate: form.hourly_rate ?? "" };
  return { ...form, contract_type: type, monthly_salary: null, hourly_rate: null };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";
  const qc    = useQueryClient();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [form, setForm] = useState<ContractSetBody>(defaultForm());
  const [showHistory, setShowHistory] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: orgUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: !!orgId && !!token,
  });

  // Auto-select first store
  useEffect(() => {
    if (!selectedStoreId && stores.length) setSelectedStoreId(stores[0].id);
  }, [stores, selectedStoreId]);

  const storeId = selectedStoreId || stores[0]?.id || "";

  // Active contract for selected user + store
  const { data: activeContract, isLoading: contractLoading } = useQuery({
    queryKey: ["contract", selectedUserId, storeId],
    queryFn: () => fetchActiveContract(selectedUserId!, storeId, token),
    enabled: !!selectedUserId && !!storeId && !!token,
  });

  // Contract history for selected user
  const { data: contractHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["contractHistory", selectedUserId],
    queryFn: () => fetchUserContracts(selectedUserId!, token),
    enabled: !!selectedUserId && !!token && showHistory,
  });

  // Org skills + the selected employee's granted skills
  const { data: orgSkills = [] } = useQuery({
    queryKey: ["orgSkills", orgId],
    queryFn: () => fetchSkills(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: userSkills = [], isLoading: userSkillsLoading } = useQuery({
    queryKey: ["userSkills", selectedUserId],
    queryFn: () => fetchUserSkills(selectedUserId!, token),
    enabled: !!selectedUserId && !!token,
  });

  const grantedSkillIds = new Set(userSkills.map(us => us.skill_id));

  // Sync form when contract loads
  useEffect(() => {
    if (activeContract) {
      setForm(formFromContract(activeContract));
    } else if (!contractLoading && selectedUserId) {
      setForm(defaultForm());
    }
  }, [activeContract, contractLoading, selectedUserId, storeId]);

  const panelOpen = selectedUserId !== null;
  const isNew = !activeContract && !contractLoading;
  const selectedUser = orgUsers.find(u => u.id === selectedUserId);

  // ── Mutation ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: () => upsertContract(selectedUserId!, storeId, form, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", selectedUserId, storeId] });
      qc.invalidateQueries({ queryKey: ["contractHistory", selectedUserId] });
      toast.success(isNew ? "合約已建立" : "合約已更新");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const assignSkillMut = useMutation({
    mutationFn: (skillId: string) => assignSkill(selectedUserId!, skillId, token),
    onSuccess: (_, skillId) => {
      qc.invalidateQueries({ queryKey: ["userSkills", selectedUserId] });
      const skill = orgSkills.find(s => s.id === skillId);
      toast.success(`已賦予「${skill?.name ?? "技能"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const revokeSkillMut = useMutation({
    mutationFn: (skillId: string) => revokeSkill(selectedUserId!, skillId, token),
    onSuccess: (_, skillId) => {
      qc.invalidateQueries({ queryKey: ["userSkills", selectedUserId] });
      const skill = orgSkills.find(s => s.id === skillId);
      toast.success(`已移除「${skill?.name ?? "技能"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const toggleSkill = (skill: SkillDTO) => {
    if (grantedSkillIds.has(skill.id)) revokeSkillMut.mutate(skill.id);
    else assignSkillMut.mutate(skill.id);
  };

  const isValid =
    form.contract_type === "FT" ? (form.monthly_salary !== null && form.monthly_salary !== "" && +form.monthly_salary > 0) :
    form.contract_type === "PT" ? (form.hourly_rate !== null && form.hourly_rate !== "" && +form.hourly_rate > 0) :
    true; // CUSTOM — no pay terms required

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">員工管理</h1>
        <p className="mt-1 text-sm text-white/40">管理員工合約與薪資設定</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

        {/* ── Left: employee list ── */}
        <div className={cn("space-y-2", panelOpen && "hidden lg:block")}>
          {usersLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/5" />
            ))
          ) : orgUsers.length === 0 ? (
            <div className="rounded-2xl border border-white/10 p-8 text-center"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <Users className="mx-auto size-8 text-white/20 mb-3" />
              <p className="text-sm text-white/30">組織中尚無員工</p>
            </div>
          ) : (
            orgUsers.map((user, i) => (
              <button key={user.id}
                onClick={() => { setSelectedUserId(user.id); setShowHistory(false); }}
                className={cn(
                  "w-full rounded-xl border text-left px-4 py-3 transition-all flex items-center gap-3",
                  selectedUserId === user.id
                    ? "border-purple-500/50 bg-purple-600/15"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                )}
              >
                {/* Avatar */}
                <div className="size-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-semibold text-white"
                  style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                  {user.name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user.name}</p>
                  <p className="text-[11px] text-white/30 truncate">{user.email}</p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── Right: contract editor ── */}
        {panelOpen && selectedUser ? (
          <div className="space-y-5">
            {/* Mobile back */}
            <button
              className="lg:hidden flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
              onClick={() => setSelectedUserId(null)}
            >
              <ChevronLeft className="size-4" />返回清單
            </button>

            {/* Employee header */}
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full flex-shrink-0 flex items-center justify-center text-base font-semibold text-white"
                style={{ background: AVATAR_COLORS[orgUsers.findIndex(u => u.id === selectedUser.id) % AVATAR_COLORS.length] }}>
                {selectedUser.name[0]}
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{selectedUser.name}</h2>
                <p className="text-xs text-white/40">{selectedUser.email}</p>
              </div>
            </div>

            {/* Store selector */}
            {stores.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40 flex-shrink-0">門市：</span>
                <Select value={storeId} onValueChange={v => { if (v) setSelectedStoreId(v); }}>
                  <SelectTrigger className="h-8 w-[140px] border-white/10 bg-white/5 text-xs text-white">
                    <span>{stores.find(s => s.id === storeId)?.name ?? "選擇門市"}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Contract form card */}
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
                  {/* Contract type */}
                  <div className="space-y-2">
                    <label className="text-xs text-white/40">合約類型</label>
                    <div className="flex gap-2 flex-wrap">
                      {CONTRACT_TYPES.map(ct => (
                        <button key={ct.key}
                          onClick={() => setForm(p => withContractType(p, ct.key))}
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

                  {/* Pay terms — shown field depends on contract type */}
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
                          onChange={e => setForm(p => ({ ...p, monthly_salary: e.target.value }))}
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
                          onChange={e => setForm(p => ({ ...p, hourly_rate: e.target.value }))}
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

                  {/* Effective from */}
                  <div className="space-y-2">
                    <label className="text-xs text-white/40">生效日期</label>
                    <input
                      type="date"
                      value={form.effective_from}
                      onChange={e => setForm(p => ({ ...p, effective_from: e.target.value }))}
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

            {/* Save button */}
            <Button
              className="gap-2 border-0 text-white hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || contractLoading || !isValid}
            >
              {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isNew ? "建立合約" : "儲存合約"}
            </Button>

            {/* Skill assignment card */}
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
                  {orgSkills.map(skill => {
                    const granted = grantedSkillIds.has(skill.id);
                    const pending =
                      (assignSkillMut.isPending && assignSkillMut.variables === skill.id) ||
                      (revokeSkillMut.isPending && revokeSkillMut.variables === skill.id);
                    return (
                      <button key={skill.id}
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

            {/* Contract history */}
            <div className="rounded-2xl border border-white/10 overflow-hidden"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <button
                onClick={() => setShowHistory(v => !v)}
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
                    contractHistory.map(c => (
                      <div key={c.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0",
                            c.contract_type === "FT"
                              ? "border-blue-500/30 bg-blue-600/15 text-blue-300"
                              : c.contract_type === "PT"
                                ? "border-green-500/30 bg-green-600/15 text-green-300"
                                : "border-white/15 bg-white/8 text-white/50",
                          )}>
                            {c.contract_type}
                          </span>
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
          </div>
        ) : (
          /* Empty state */
          <div className="hidden lg:flex items-center justify-center rounded-2xl border border-white/10 min-h-[400px]"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="text-center">
              <Users className="mx-auto size-10 text-white/15 mb-3" />
              <p className="text-sm text-white/30">選擇左側員工設定合約</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
