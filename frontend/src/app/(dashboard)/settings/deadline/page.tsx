"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, AlarmClock, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores } from "@/lib/schedules-api";
import { fetchDeadlineConfig, saveDeadlineConfig } from "@/lib/deadline-api";

// ─── Constants ─────────────────────────────────────────────────────────────

// days_before_week_start: 0 = Monday itself, 1 = Sunday, 2 = Saturday … 7 = prev Monday
const DAY_OPTIONS = [
  { value: 7, label: "週一（前週）", short: "前7天" },
  { value: 6, label: "週二",         short: "前6天" },
  { value: 5, label: "週三",         short: "前5天" },
  { value: 4, label: "週四",         short: "前4天" },
  { value: 3, label: "週五",         short: "前3天" },
  { value: 2, label: "週六",         short: "前2天", isDefault: true },
  { value: 1, label: "週日",         short: "前1天" },
  { value: 0, label: "週一（當週）", short: "當天" },
];

const DEFAULT_DAYS = 2;
const DEFAULT_TIME = "22:00";

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtTime(t: string) {
  // "HH:MM:SS" or "HH:MM" → "HH:MM"
  return t.slice(0, 5);
}

function getDeadlinePreview(days: number, time: string): string {
  const dayLabel = DAY_OPTIONS.find((d) => d.value === days)?.label ?? "";
  return `員工需在每週 ${dayLabel} ${time} 前提交下週可用時段`;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function DeadlinePage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";
  const qc    = useQueryClient();

  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [days, setDays]   = useState(DEFAULT_DAYS);
  const [time, setTime]   = useState(DEFAULT_TIME);
  const [isDirty, setIsDirty] = useState(false);
  const [isNew, setIsNew] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  useEffect(() => {
    if (!selectedStoreId && stores.length > 0) setSelectedStoreId(stores[0].id);
  }, [stores, selectedStoreId]);

  const storeId = selectedStoreId || stores[0]?.id || "";

  const { data: config, isLoading } = useQuery({
    queryKey: ["deadlineConfig", storeId],
    queryFn: () => fetchDeadlineConfig(storeId, token),
    enabled: !!storeId && !!token,
    retry: (count, err: Error & { status?: number }) => err.status !== 404 && count < 2,
  });

  // Sync form when config loads or 404 (new)
  useEffect(() => {
    if (config) {
      setDays(config.days_before_week_start);
      setTime(fmtTime(config.deadline_time));
      setIsNew(false);
    } else if (!isLoading && storeId) {
      setDays(DEFAULT_DAYS);
      setTime(DEFAULT_TIME);
      setIsNew(true);
    }
    setIsDirty(false);
  }, [config, isLoading, storeId]);

  // ── Mutation ──────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: () => saveDeadlineConfig(storeId, days, time, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deadlineConfig", storeId] });
      setIsDirty(false);
      setIsNew(false);
      toast.success("截止日設定已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const preview = getDeadlinePreview(days, time);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">排班截止日設定</h1>
          <p className="mt-1 text-sm text-white/40">設定員工提交可用時段的截止時間</p>
        </div>
        <Select value={storeId} onValueChange={(v) => { if (v) setSelectedStoreId(v); }}>
          <SelectTrigger className="h-9 w-[130px] border-white/10 bg-white/5 text-sm text-white">
            <span>{stores.find((s) => s.id === storeId)?.name ?? "選擇門市"}</span>
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl bg-white/5" />
          <Skeleton className="h-24 w-full rounded-2xl bg-white/5" />
        </div>
      ) : (
        <>
          {/* Config card */}
          <div
            className="rounded-2xl border border-white/10 p-6 space-y-6"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
          >
            {isNew && (
              <div className="flex items-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-2.5">
                <Info className="size-4 text-yellow-400 flex-shrink-0" />
                <p className="text-xs text-yellow-300/80">此門市尚未設定截止日，儲存後生效</p>
              </div>
            )}

            {/* Days selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">截止日（每週幾）</label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setDays(opt.value); setIsDirty(true); }}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 text-center transition-all border",
                      days === opt.value
                        ? "border-purple-500/60 bg-purple-600/30 text-white"
                        : "border-white/10 bg-white/5 text-white/40 hover:bg-white/8 hover:text-white/70",
                    )}
                  >
                    <span className="text-xs font-semibold leading-tight">{opt.label.replace("（", "\n（")}</span>
                    {opt.isDefault && (
                      <span className="text-[9px] text-purple-400/70 leading-tight">預設</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Time input */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">截止時間</label>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => { setTime(e.target.value); setIsDirty(true); }}
                  className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white transition-colors hover:border-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  style={{ colorScheme: "dark" }}
                />
                <span className="text-sm text-white/40">（24 小時制）</span>
              </div>
            </div>
          </div>

          {/* Preview card */}
          <div
            className="flex items-start gap-3 rounded-2xl border border-purple-500/20 bg-purple-600/10 px-5 py-4"
          >
            <AlarmClock className="mt-0.5 size-4 text-purple-400 flex-shrink-0" />
            <p className="text-sm text-purple-200/80 leading-relaxed">{preview}</p>
          </div>

          {/* Save */}
          <Button
            className="gap-2 border-0 text-white hover:opacity-90"
            style={{
              background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
              boxShadow: "0 2px 16px rgba(124,58,237,0.3)",
            }}
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !isDirty}
          >
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isDirty ? (isNew ? "建立設定" : "儲存變更") : "已儲存"}
          </Button>
        </>
      )}
    </div>
  );
}
