"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, ShieldCheck, Eye, Building2, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { StoreDTO } from "@/lib/schedules-api";
import {
  fetchRoleGroups, fetchUserRoleGroups, assignRoleGroup, revokeRoleGroup,
} from "@/lib/role-groups-api";

export function PermissionsTab({
  userId, orgId, token, stores, editable,
}: {
  userId: string;
  orgId: string;
  token: string;
  stores: StoreDTO[];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const { data: orgGroups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["roleGroups", orgId],
    queryFn: () => fetchRoleGroups(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: userGroups = [], isLoading: userGroupsLoading } = useQuery({
    queryKey: ["userRoleGroups", userId],
    queryFn: () => fetchUserRoleGroups(userId, token),
    enabled: !!userId && !!token,
  });

  const grantedIds = useMemo(() => new Set(userGroups.map((ug) => ug.role_group_id)), [userGroups]);

  const assignMut = useMutation({
    mutationFn: (groupId: string) => assignRoleGroup(userId, groupId, token),
    onSuccess: (_, groupId) => {
      qc.invalidateQueries({ queryKey: ["userRoleGroups", userId] });
      toast.success(`已賦予「${orgGroups.find((g) => g.id === groupId)?.name ?? "身份組"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const revokeMut = useMutation({
    mutationFn: (groupId: string) => revokeRoleGroup(userId, groupId, token),
    onSuccess: (_, groupId) => {
      qc.invalidateQueries({ queryKey: ["userRoleGroups", userId] });
      toast.success(`已移除「${orgGroups.find((g) => g.id === groupId)?.name ?? "身份組"}」`);
    },
    onError: (e: Error) => toast.error(`操作失敗：${e.message}`),
  });

  const toggle = (groupId: string) => {
    if (!editable) return;
    if (grantedIds.has(groupId)) revokeMut.mutate(groupId);
    else assignMut.mutate(groupId);
  };

  const loading = groupsLoading || userGroupsLoading;

  return (
    <div className="rounded-2xl border border-white/10 p-5 space-y-4"
      style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-white/40" />
          <h3 className="text-sm font-medium text-white/70">身份組</h3>
        </div>
        {!editable && <Badge className="border-white/15 bg-white/8 text-white/50 text-xs gap-1"><Eye className="size-2.5" />唯讀</Badge>}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/5" />)}
        </div>
      ) : orgGroups.length === 0 ? (
        <p className="text-[11px] text-white/25">組織尚未建立任何身份組</p>
      ) : (
        <div className="space-y-2">
          {orgGroups.map((g) => {
            const granted = grantedIds.has(g.id);
            const pending =
              (assignMut.isPending && assignMut.variables === g.id) ||
              (revokeMut.isPending && revokeMut.variables === g.id);
            const orgLevel = g.store_ids.length === 0;
            return (
              <button
                key={g.id}
                onClick={() => toggle(g.id)}
                disabled={pending || !editable}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-all flex items-center gap-3 disabled:cursor-not-allowed",
                  granted ? "border-purple-500/50 bg-purple-600/15" : "border-white/10 bg-white/[0.03]",
                  editable && !granted && "hover:bg-white/[0.06]",
                )}
              >
                <div className={cn(
                  "size-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-all",
                  granted ? "border-purple-500 bg-purple-600" : "border-white/20",
                )}>
                  {pending ? <Loader2 className="size-3 animate-spin text-white" /> : granted ? <Check className="size-3 text-white" strokeWidth={3} /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{g.name}</span>
                    <span className="text-[10px] text-white/30 flex-shrink-0">{g.permissions.length} 項權限</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/35">
                    {orgLevel ? (
                      <><Globe className="size-2.5" />組織層級</>
                    ) : (
                      <><Building2 className="size-2.5" />{g.store_ids.map((id) => storeName.get(id) ?? "未知門市").join("、")}</>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editable && <p className="text-[11px] text-white/25">點擊身份組以賦予或移除該員工的權限</p>}
    </div>
  );
}
