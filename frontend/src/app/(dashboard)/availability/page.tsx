"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Copy, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchAvailability, saveAvailability } from "@/lib/availability-api";
import { fetchMyPreferences, saveMyPreferences } from "@/lib/preferences-api";
import { fetchMe, updateMe } from "@/lib/users-api";
import { fetchStores } from "@/lib/schedules-api";
import { AvailabilityGrid as SharedAvailabilityGrid } from "@/components/shared/availability-grid";
import { StorePreferences as SharedStorePreferences } from "@/components/shared/store-preferences";

// ─── Types ─────────────────────────────────────────────────────────────────

type Slots = boolean[][];

// ─── Helpers ───────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeeks() {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i * 7);
    return {
      label: i === 0 ? `本週 ${d.getMonth() + 1}/${d.getDate()}` : `${d.getMonth() + 1}/${d.getDate()}`,
      date: toLocalDateStr(d),
    };
  });
}

const emptySlots = (): Slots =>
  Array.from({ length: 7 }, () => Array(24).fill(false));

// ─── AvailabilityGrid ──────────────────────────────────────────────────────

function AvailabilityGrid() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const queryClient = useQueryClient();

  const weeks = getWeeks();
  const fromDate = weeks[0].date;

  const [activeWeek, setActiveWeek] = useState(weeks[0].date);
  const [weekSlots, setWeekSlots] = useState<Record<string, Slots>>({});
  const [dirtyWeeks, setDirtyWeeks] = useState<Set<string>>(new Set());
  const [lockedWeeks, setLockedWeeks] = useState<Set<string>>(new Set());

  // Load all 4 weeks from API
  const { data: availabilityData, isLoading } = useQuery({
    queryKey: ["availability", token, fromDate],
    queryFn: () => fetchAvailability(fromDate, token),
    enabled: !!token,
  });

  useEffect(() => {
    if (!availabilityData) return;
    const loaded: Record<string, Slots> = {};
    const locked = new Set<string>();
    availabilityData.forEach((av) => {
      loaded[av.week_start] = av.slots;
      if (av.locked) locked.add(av.week_start);
    });
    setWeekSlots((prev) => {
      const next = { ...prev };
      Object.entries(loaded).forEach(([w, s]) => {
        if (!dirtyWeeks.has(w)) next[w] = s;
      });
      return next;
    });
    setLockedWeeks(locked);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityData]);

  // Save current week
  const saveMutation = useMutation({
    mutationFn: () =>
      saveAvailability(activeWeek, weekSlots[activeWeek] ?? emptySlots(), token),
    onSuccess: () => {
      setDirtyWeeks((prev) => { const n = new Set(prev); n.delete(activeWeek); return n; });
      queryClient.invalidateQueries({ queryKey: ["availability", token, fromDate] });
      toast.success("時段已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const isLocked = lockedWeeks.has(activeWeek);
  const isDirty = dirtyWeeks.has(activeWeek);

  const slots = weekSlots[activeWeek] ?? emptySlots();
  const setSlots = useCallback(
    (s: Slots) => {
      setWeekSlots((p) => ({ ...p, [activeWeek]: s }));
      setDirtyWeeks((prev) => new Set(prev).add(activeWeek));
    },
    [activeWeek],
  );

  const selectedCount = slots.flat().filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Week selector + count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {weeks.map((w) => {
            const locked = lockedWeeks.has(w.date);
            const dirty  = dirtyWeeks.has(w.date);
            return (
              <button
                key={w.date}
                onClick={() => setActiveWeek(w.date)}
                className={cn(
                  "relative rounded-lg px-4 py-1.5 text-sm font-medium transition-all",
                  activeWeek === w.date
                    ? "bg-purple-600/40 text-white"
                    : "text-white/40 hover:text-white/70",
                )}
              >
                {w.label}
                {locked && <Lock className="inline ml-1 size-2.5 text-yellow-400/70" />}
                {dirty && !locked && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-purple-400" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="size-3.5 text-white/30 animate-spin" />}
          {isLocked && <Badge className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs gap-1"><Lock className="size-2.5" />已鎖定</Badge>}
          <Badge className="border-purple-500/30 bg-purple-600/20 text-purple-300">
            已選 {selectedCount} 小時
          </Badge>
        </div>
      </div>

      {/* Grid */}
      <SharedAvailabilityGrid
        slots={slots}
        onChange={setSlots}
        editable={!isLocked}
      />

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-2 border-0 text-white hover:opacity-90"
          style={{
            background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
            boxShadow: "0 2px 16px rgba(124,58,237,0.3)",
          }}
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLocked || !isDirty}
        >
          {saveMutation.isPending
            ? <Loader2 className="size-4 animate-spin" />
            : <Save className="size-4" />}
          {isDirty ? "儲存時段" : "已儲存"}
        </Button>
        <Button
          variant="outline"
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
          onClick={() => { setSlots(emptySlots()); toast.info("已清除時段"); }}
          disabled={isLocked}
        >
          <RefreshCw className="size-4" />
          清除
        </Button>
        <Button
          variant="outline"
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
          onClick={() => {
            if (isLocked) return;
            const idx = weeks.findIndex((w) => w.date === activeWeek);
            if (idx > 0) {
              const prevSlots = weekSlots[weeks[idx - 1].date];
              if (prevSlots) {
                setSlots(prevSlots.map((r) => [...r]));
                toast.success("已從上週複製");
              } else {
                toast.info("上週沒有資料可複製");
              }
            } else {
              toast.info("目前是第一週，沒有上週資料");
            }
          }}
          disabled={isLocked}
        >
          <Copy className="size-4" />
          從上週複製
        </Button>
      </div>
    </div>
  );
}

// ─── StorePreferences (self-service wrapper around shared component) ──────────

function StorePreferences() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";
  const qc = useQueryClient();

  const { data: storeList = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: me } = useQuery({
    queryKey: ["me", token],
    queryFn: () => fetchMe(token),
    enabled: !!token,
  });

  return (
    <SharedStorePreferences
      storeList={storeList}
      enabled={!!token}
      prefsQueryKey={["myPreferences", token]}
      fetchPreferences={() => fetchMyPreferences(token)}
      savePreferences={(prefs) => saveMyPreferences(prefs, token)}
      dailyHourMax={me?.daily_hour_max ?? null}
      saveDailyHourMax={(cap) => updateMe({ daily_hour_max: cap }, token)}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ["myPreferences", token] });
        qc.invalidateQueries({ queryKey: ["me", token] });
      }}
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">排班設定</h1>
        <p className="mt-1 text-sm text-white/40">
          填寫可用時段與門市偏好，系統依此自動排班
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="availability">
        <TabsList className="h-auto gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          <TabsTrigger
            value="availability"
            className="rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none"
          >
            可用時段
          </TabsTrigger>
          <TabsTrigger
            value="preferences"
            className="rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none"
          >
            門市偏好
          </TabsTrigger>
        </TabsList>

        <TabsContent value="availability" className="mt-5">
          <AvailabilityGrid />
        </TabsContent>
        <TabsContent value="preferences" className="mt-5">
          <StorePreferences />
        </TabsContent>
      </Tabs>
    </div>
  );
}
