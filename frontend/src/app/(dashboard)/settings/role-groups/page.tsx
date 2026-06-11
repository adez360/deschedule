"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, Loader2, ShieldCheck, UserPlus, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores, fetchOrgUsers } from "@/lib/schedules-api";
import {
  fetchRoleGroups, createRoleGroup, updateRoleGroup, deleteRoleGroup,
  fetchUserRoleGroups, assignRoleGroup, revokeRoleGroup,
  type RoleGroupDTO,
} from "@/lib/role-groups-api";

// ─── Permission groups ──────────────────────────────────────────────────────

const PERM_GROUPS = [
  {
    key: "system", label: "系統", colorCls: "text-red-400",
    perms: [{ key: "system.all", label: "全系統管理" }],
  },
  {
    key: "org", label: "組織", colorCls: "text-orange-400",
    perms: [
      { key: "org.manage",            label: "管理組織設定" },
      { key: "org.schedule.view_all", label: "查看所有門市班表" },
      { key: "org.schedule.arrange",  label: "執行自動排班" },
      { key: "org.employee.manage",   label: "管理員工" },
    ],
  },
  {
    key: "store", label: "門市", colorCls: "text-blue-400",
    perms: [
      { key: "store.schedule.view",            label: "查看門市班表" },
      { key: "store.schedule.edit",            label: "編輯門市班表" },
      { key: "store.demand.edit",              label: "編輯人力需求" },
      { key: "store.schedule.deadline.manage", label: "設定截止日" },
    ],
  },
  {
    key: "self", label: "個人", colorCls: "text-green-400",
    perms: [
      { key: "self.schedule.view",     label: "查看自己班表" },
      { key: "self.availability.edit", label: "編輯可用時段" },
      { key: "self.preference.edit",   label: "編輯門市偏好" },
      { key: "self.profile.edit",      label: "編輯個人資料" },
    ],
  },
  {
    key: "employee", label: "員工管理", colorCls: "text-purple-400",
    perms: [
      { key: "employee.availability.edit", label: "編輯員工時段" },
      { key: "employee.preference.edit",   label: "編輯員工偏好" },
      { key: "employee.payroll.view",      label: "查看薪資報告" },
      { key: "employee.contract.edit",     label: "設定員工合約" },
      { key: "employee.identity.view",     label: "查看員工真實姓名" },
    ],
  },
] as const;

// ─── Form state ─────────────────────────────────────────────────────────────

interface FormState { name: string; store_ids: string[]; permissions: string[] }

const emptyForm = (): FormState => ({ name: "", store_ids: [], permissions: [] });

function formFromRg(rg: RoleGroupDTO): FormState {
  return { name: rg.name, store_ids: [...rg.store_ids], permissions: [...rg.permissions] };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RoleGroupsPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";
  const qc    = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [addUserId, setAddUserId] = useState("");
  const [memberMap, setMemberMap] = useState<Record<string, string[]>>({});
  const [membersLoading, setMembersLoading] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: roleGroups = [], isLoading: rgLoading } = useQuery({
    queryKey: ["roleGroups", orgId],
    queryFn: () => fetchRoleGroups(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: orgUsers = [] } = useQuery({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: !!orgId && !!token,
  });

  // Batch-load all user→roleGroup assignments for the member map
  const loadMemberMap = useCallback(async () => {
    if (!orgUsers.length || !token) return;
    setMembersLoading(true);
    try {
      const results = await Promise.all(
        orgUsers.map(u =>
          fetchUserRoleGroups(u.id, token)
            .then(rgs => ({ userId: u.id, rgIds: rgs.map(r => r.role_group_id) }))
            .catch(() => ({ userId: u.id, rgIds: [] as string[] }))
        )
      );
      const map: Record<string, string[]> = {};
      results.forEach(({ userId, rgIds }) =>
        rgIds.forEach(rgId => { (map[rgId] ??= []).push(userId); })
      );
      setMemberMap(map);
    } finally {
      setMembersLoading(false);
    }
  }, [orgUsers, token]);

  useEffect(() => { loadMemberMap(); }, [loadMemberMap]);

  // Sync form when selection changes
  useEffect(() => {
    if (isCreating) { setForm(emptyForm()); return; }
    const rg = roleGroups.find(r => r.id === selectedId);
    if (rg) setForm(formFromRg(rg));
  }, [selectedId, isCreating, roleGroups]);

  const panelOpen = isCreating || selectedId !== null;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: () => createRoleGroup(orgId, form, token),
    onSuccess: (rg) => {
      qc.invalidateQueries({ queryKey: ["roleGroups", orgId] });
      setIsCreating(false);
      setSelectedId(rg.id);
      toast.success("身份組已建立");
    },
    onError: (e: Error) => toast.error(`建立失敗：${e.message}`),
  });

  const updateMut = useMutation({
    mutationFn: () => updateRoleGroup(selectedId!, { name: form.name, store_ids: form.store_ids, permissions: form.permissions }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roleGroups", orgId] });
      toast.success("身份組已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteRoleGroup(selectedId!, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roleGroups", orgId] });
      setSelectedId(null);
      toast.success("身份組已刪除");
    },
    onError: (e: Error) => toast.error(`刪除失敗：${e.message}`),
  });

  const assignMut = useMutation({
    mutationFn: (userId: string) => assignRoleGroup(userId, selectedId!, token),
    onSuccess: (_, userId) => {
      setMemberMap(prev => ({ ...prev, [selectedId!]: [...(prev[selectedId!] ?? []), userId] }));
      setAddUserId("");
      toast.success("成員已指派");
    },
    onError: (e: Error) => toast.error(`指派失敗：${e.message}`),
  });

  const revokeMut = useMutation({
    mutationFn: (userId: string) => revokeRoleGroup(userId, selectedId!, token),
    onSuccess: (_, userId) => {
      setMemberMap(prev => ({ ...prev, [selectedId!]: (prev[selectedId!] ?? []).filter(id => id !== userId) }));
      toast.success("成員已移除");
    },
    onError: (e: Error) => toast.error(`移除失敗：${e.message}`),
  });

  // ── Permission helpers ────────────────────────────────────────────────────

  const togglePerm = (key: string) =>
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter(p => p !== key)
        : [...prev.permissions, key],
    }));

  const toggleGroup = (keys: readonly string[]) => {
    const allOn = keys.every(k => form.permissions.includes(k));
    setForm(prev => ({
      ...prev,
      permissions: allOn
        ? prev.permissions.filter(p => !keys.includes(p))
        : [...new Set([...prev.permissions, ...keys])],
    }));
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const members = selectedId
    ? (memberMap[selectedId] ?? []).map(id => orgUsers.find(u => u.id === id)).filter(Boolean)
    : [];

  const unassignedUsers = selectedId
    ? orgUsers.filter(u => !(memberMap[selectedId] ?? []).includes(u.id))
    : [];

  const isMutating = createMut.isPending || updateMut.isPending || deleteMut.isPending;
  const selectedRg = roleGroups.find(r => r.id === selectedId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">身份組管理</h1>
          <p className="mt-1 text-sm text-white/40">設定各身份組的名稱與權限</p>
        </div>
        <Button
          className="gap-2 border-0 text-white hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
          onClick={() => { setIsCreating(true); setSelectedId(null); }}
        >
          <Plus className="size-4" />新增身份組
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

        {/* ── Left: list ── */}
        <div className={cn("space-y-2", panelOpen && "hidden lg:block")}>
          {rgLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/5" />
            ))
          ) : roleGroups.length === 0 ? (
            <div className="rounded-2xl border border-white/10 p-8 text-center"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <ShieldCheck className="mx-auto size-8 text-white/20 mb-3" />
              <p className="text-sm text-white/30">尚無身份組</p>
              <p className="text-xs text-white/20 mt-1">點擊右上角新增</p>
            </div>
          ) : (
            roleGroups.map(rg => {
              const memberCount = (memberMap[rg.id] ?? []).length;
              const scopeLabel = rg.store_ids.length === 0
                ? "全組織"
                : rg.store_ids.length === 1
                  ? (stores.find(s => s.id === rg.store_ids[0])?.name ?? "1 間門市")
                  : `${rg.store_ids.length} 間門市`;
              return (
                <button key={rg.id}
                  onClick={() => { setSelectedId(rg.id); setIsCreating(false); }}
                  className={cn(
                    "w-full rounded-xl border text-left px-4 py-3 transition-all space-y-1",
                    selectedId === rg.id
                      ? "border-purple-500/50 bg-purple-600/15"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">{rg.name}</span>
                    <span className="text-[10px] text-white/30 flex-shrink-0">{memberCount} 人</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white/40">
                      {scopeLabel}
                    </span>
                    <span className="text-[10px] text-white/30">{rg.permissions.length} 項權限</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* ── Right: editor ── */}
        {panelOpen ? (
          <div className="space-y-5">
            {/* Mobile back */}
            <button
              className="lg:hidden flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
              onClick={() => { setSelectedId(null); setIsCreating(false); }}
            >
              <ChevronLeft className="size-4" />返回清單
            </button>

            {/* Name + scope */}
            <div className="rounded-2xl border border-white/10 p-5 space-y-4"
              style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
              <h3 className="text-sm font-medium text-white/70">
                {isCreating ? "新增身份組" : "編輯身份組"}
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs text-white/40">名稱</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="例如：門市主管"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-white/40">適用範圍</label>
                  {form.store_ids.length > 0 && (
                    <button
                      onClick={() => setForm(p => ({ ...p, store_ids: [] }))}
                      className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      清除（改為全組織）
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06] overflow-hidden">
                  {/* 全組織 option */}
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, store_ids: [] }))}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                      form.store_ids.length === 0
                        ? "bg-purple-600/15 text-white"
                        : "text-white/40 hover:bg-white/[0.04] hover:text-white/70",
                    )}
                  >
                    <span className={cn(
                      "flex-shrink-0 size-3.5 rounded-full border-2 flex items-center justify-center transition-colors",
                      form.store_ids.length === 0 ? "border-purple-400 bg-purple-500" : "border-white/20",
                    )}>
                      {form.store_ids.length === 0 && (
                        <span className="size-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className="text-xs">全組織（所有門市）</span>
                  </button>

                  {/* Individual stores */}
                  {stores.map(store => {
                    const checked = form.store_ids.includes(store.id);
                    return (
                      <button
                        key={store.id}
                        type="button"
                        onClick={() => setForm(p => ({
                          ...p,
                          store_ids: checked
                            ? p.store_ids.filter(id => id !== store.id)
                            : [...p.store_ids, store.id],
                        }))}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                          checked
                            ? "bg-purple-600/15 text-white"
                            : "text-white/40 hover:bg-white/[0.04] hover:text-white/70",
                        )}
                      >
                        <span className={cn(
                          "flex-shrink-0 size-3.5 rounded-sm border-2 flex items-center justify-center transition-colors",
                          checked ? "border-purple-400 bg-purple-500" : "border-white/20",
                        )}>
                          {checked && (
                            <svg className="size-2 text-white" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4l2 2L6.5 2" stroke="currentColor" strokeWidth="1.5"
                                strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="text-xs">{store.name}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-white/25">
                  {form.store_ids.length === 0 ? "此身份組的權限適用於組織內所有門市" : `已選 ${form.store_ids.length} 間門市`}
                </p>
              </div>
            </div>

            {/* Permissions */}
            <div className="rounded-2xl border border-white/10 p-5 space-y-5"
              style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
              <h3 className="text-sm font-medium text-white/70">權限設定</h3>

              {PERM_GROUPS.map(group => {
                const keys = group.perms.map(p => p.key);
                const allOn = keys.every(k => form.permissions.includes(k));
                const someOn = keys.some(k => form.permissions.includes(k));

                return (
                  <div key={group.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs font-semibold uppercase tracking-wide", group.colorCls)}>
                        {group.label}
                      </span>
                      <button
                        onClick={() => toggleGroup(keys)}
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded border transition-colors",
                          allOn
                            ? "border-purple-500/40 bg-purple-600/15 text-purple-300"
                            : someOn
                              ? "border-white/15 bg-white/5 text-white/40"
                              : "border-white/10 bg-transparent text-white/25 hover:text-white/50",
                        )}
                      >
                        {allOn ? "全部取消" : "全選"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {group.perms.map(perm => {
                        const on = form.permissions.includes(perm.key);
                        return (
                          <button
                            key={perm.key}
                            onClick={() => togglePerm(perm.key)}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all border",
                              on
                                ? "border-purple-500/30 bg-purple-600/15 text-white"
                                : "border-white/[0.07] bg-white/[0.02] text-white/35 hover:bg-white/[0.05] hover:text-white/60",
                            )}
                          >
                            <span className={cn(
                              "flex-shrink-0 size-3.5 rounded-sm border-2 flex items-center justify-center transition-colors",
                              on ? "border-purple-400 bg-purple-500" : "border-white/20",
                            )}>
                              {on && (
                                <svg className="size-2 text-white" viewBox="0 0 8 8" fill="none">
                                  <path d="M1.5 4l2 2L6.5 2" stroke="currentColor" strokeWidth="1.5"
                                    strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                            <span className="text-xs leading-tight">{perm.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Members (edit mode only) */}
            {!isCreating && selectedId && (
              <div className="rounded-2xl border border-white/10 p-5 space-y-4"
                style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
                <h3 className="text-sm font-medium text-white/70">成員管理</h3>

                <div className="flex gap-2">
                  <Select value={addUserId} onValueChange={v => { if (v) setAddUserId(v); }}>
                    <SelectTrigger className="flex-1 h-9 border-white/10 bg-white/5 text-sm text-white">
                      <span className={addUserId ? "text-white" : "text-white/30"}>
                        {addUserId ? orgUsers.find(u => u.id === addUserId)?.name : "選擇員工指派"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {unassignedUsers.length === 0
                        ? <SelectItem value="_none" disabled>所有成員已指派</SelectItem>
                        : unassignedUsers.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="gap-1.5 border-white/10 text-white/60 hover:bg-white/5 hover:text-white h-9 px-3 flex-shrink-0"
                    onClick={() => addUserId && assignMut.mutate(addUserId)}
                    disabled={!addUserId || assignMut.isPending}
                  >
                    {assignMut.isPending
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <UserPlus className="size-3.5" />}
                    指派
                  </Button>
                </div>

                {membersLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded-lg bg-white/5" />
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <p className="text-xs text-white/25 py-1">尚無成員</p>
                ) : (
                  <div className="space-y-1.5">
                    {members.map(user => user && (
                      <div key={user.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-white/80 truncate">{user.name}</p>
                          <p className="text-[11px] text-white/30 truncate">{user.email}</p>
                        </div>
                        <button
                          onClick={() => revokeMut.mutate(user.id)}
                          disabled={revokeMut.isPending}
                          className="text-white/25 hover:text-red-400 transition-colors p-1 rounded flex-shrink-0"
                          aria-label="移除成員"
                        >
                          {revokeMut.isPending && revokeMut.variables === user.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <X className="size-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {isCreating ? (
                <>
                  <Button
                    className="gap-2 border-0 text-white hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
                    onClick={() => createMut.mutate()}
                    disabled={isMutating || !form.name.trim()}
                  >
                    {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    建立身份組
                  </Button>
                  <Button variant="outline" className="border-white/10 text-white/50 hover:bg-white/5"
                    onClick={() => { setIsCreating(false); setSelectedId(null); }}>
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    className="gap-2 border-0 text-white hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
                    onClick={() => updateMut.mutate()}
                    disabled={isMutating || !form.name.trim()}
                  >
                    {updateMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    儲存變更
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                    onClick={() => {
                      if (confirm(`確定要刪除「${selectedRg?.name}」？此操作無法復原。`)) {
                        deleteMut.mutate();
                      }
                    }}
                    disabled={isMutating}
                  >
                    {deleteMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    刪除
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          /* Empty state when nothing selected */
          <div className="hidden lg:flex items-center justify-center rounded-2xl border border-white/10 min-h-[400px]"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="text-center">
              <ShieldCheck className="mx-auto size-10 text-white/15 mb-3" />
              <p className="text-sm text-white/30">選擇左側身份組進行編輯</p>
              <p className="text-xs text-white/20 mt-1">或點擊「新增身份組」建立新的</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
