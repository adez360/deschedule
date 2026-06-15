"use client";

import { useState, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Plus, Search, Pencil, Trash2, Loader2, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores } from "@/lib/schedules-api";
import {
  createStore, updateStore, deleteStore,
  type StoreDTO, type StoreBody,
} from "@/lib/stores-api";

// ─── Constants ──────────────────────────────────────────────────────────────

const TIMEZONES = [
  "Asia/Taipei", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Hong_Kong", "Asia/Singapore", "Asia/Seoul", "UTC",
];

const DEFAULT_FORM: StoreBody = { name: "", timezone: "Asia/Taipei", cross_group: "" };

// ─── Store Dialog (add + edit) ───────────────────────────────────────────────

function StoreDialog({
  open, onClose, initial, orgId, token,
}: {
  open: boolean;
  onClose: () => void;
  initial: StoreDTO | null;
  orgId: string;
  token: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<StoreBody>(DEFAULT_FORM);

  useEffect(() => {
    if (open) setForm(initial
      ? { name: initial.name, timezone: initial.timezone, cross_group: initial.cross_group ?? "" }
      : DEFAULT_FORM);
  }, [open, initial]);

  const saveMut = useMutation({
    mutationFn: () => {
      const body = { ...form, cross_group: form.cross_group?.trim() || null };
      return initial ? updateStore(initial.id, body, token) : createStore(orgId, body, token);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stores", orgId] });
      toast.success(initial ? "門市已更新" : "門市已新增");
      onClose();
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const isValid = form.name.trim().length >= 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-white/10 bg-[#1a1a2e] text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-white">{initial ? "編輯門市" : "新增門市"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs text-white/40">門市名稱 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && isValid && !saveMut.isPending && saveMut.mutate()}
              placeholder="例如：信義旗艦店"
              autoFocus
              className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-white/40">時區</label>
            <Select value={form.timezone} onValueChange={(v) => setForm((p) => ({ ...p, timezone: v ?? p.timezone }))}>
              <SelectTrigger className="h-10 w-full border-white/10 bg-white/5 text-sm text-white">
                <span>{form.timezone}</span>
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-white/40">跨店群組</label>
            <input
              type="text"
              value={form.cross_group ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, cross_group: e.target.value }))}
              placeholder="例如：北區（留空 = 不跨店）"
              className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
            <p className="text-[11px] text-white/25">同群組的門市可互相跨店排班；未設群組的門市只排自己的員工</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saveMut.isPending}
            className="text-white/50 hover:text-white hover:bg-white/5"
          >
            取消
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!isValid || saveMut.isPending}
            className="gap-2 border-0 text-white hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
          >
            {saveMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {initial ? "儲存" : "新增"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StoresPage() {
  const { data: session } = useSession();
  const token  = session?.user?.access_token ?? "";
  const orgId  = session?.user?.organization_id ?? "";
  const qc     = useQueryClient();

  const [search, setSearch]           = useState("");
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editingStore, setEditingStore] = useState<StoreDTO | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["stores", orgId],
    queryFn:  () => fetchStores(orgId, token),
    enabled:  !!orgId && !!token,
  });

  const filteredStores = useMemo(() => {
    if (!search.trim()) return stores;
    const q = search.toLowerCase();
    return stores.filter((s) => s.name.toLowerCase().includes(q));
  }, [stores, search]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteStore(id, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stores", orgId] });
      toast.success("門市已刪除");
      setDeletingId(null);
    },
    onError: (e: Error) => {
      toast.error(`刪除失敗：${e.message}`);
      setDeletingId(null);
    },
  });

  const openAdd  = () => { setEditingStore(null); setDialogOpen(true); };
  const openEdit = (s: StoreDTO) => { setEditingStore(s); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditingStore(null); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">門市管理</h1>
          <p className="mt-1 text-sm text-white/40">新增、編輯與管理組織下的門市</p>
        </div>
        <Button
          onClick={openAdd}
          className="gap-2 border-0 text-white hover:opacity-90 flex-shrink-0"
          style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
        >
          <Plus className="size-4" />新增門市
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/30 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋門市名稱..."
          className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
        />
      </div>

      {/* Store grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : filteredStores.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 py-16"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          <Building2 className="size-10 text-white/15 mb-3" />
          <p className="text-sm text-white/30">
            {search.trim() ? `找不到「${search}」相符的門市` : "尚無門市，點擊「新增門市」開始"}
          </p>
          {search.trim() && (
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-xs text-purple-400/70 hover:text-purple-400 transition-colors"
            >
              清除搜尋
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStores.map((store) => (
            <div
              key={store.id}
              className="rounded-2xl border border-white/10 p-5 flex flex-col gap-3 transition-colors hover:border-white/[0.18]"
              style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ background: "rgba(124,58,237,0.18)" }}>
                  <Building2 className="size-5 text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{store.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Globe className="size-3 text-white/30 flex-shrink-0" />
                    <p className="text-[11px] text-white/30 truncate">{store.timezone}</p>
                  </div>
                </div>
                {store.cross_group && (
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] text-purple-300"
                    style={{ background: "rgba(124,58,237,0.18)" }}>
                    {store.cross_group}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 pt-2.5 border-t border-white/[0.06]">
                <button
                  onClick={() => openEdit(store)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
                >
                  <Pencil className="size-3" />編輯
                </button>
                <button
                  onClick={() => setDeletingId(store.id)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-red-400/50 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors"
                >
                  <Trash2 className="size-3" />刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <StoreDialog
        open={dialogOpen}
        onClose={closeDialog}
        initial={editingStore}
        orgId={orgId}
        token={token}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletingId} onOpenChange={(v) => !v && setDeletingId(null)}>
        <DialogContent className="border-white/10 bg-[#1a1a2e] text-white sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-white">確認刪除門市？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/40">此操作無法復原。門市相關的排班資料將一併移除。</p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeletingId(null)}
              className="text-white/50 hover:text-white hover:bg-white/5"
            >
              取消
            </Button>
            <Button
              onClick={() => deletingId && deleteMut.mutate(deletingId)}
              disabled={deleteMut.isPending}
              className="gap-2 bg-red-600 hover:bg-red-500 text-white border-0"
            >
              {deleteMut.isPending && <Loader2 className="size-4 animate-spin" />}
              刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
