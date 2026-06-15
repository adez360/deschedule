"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

const STORE_COLORS = [
  "#7C3AED", "#2563EB", "#059669", "#D97706", "#EC4899", "#0891B2",
];

// ─── Types ─────────────────────────────────────────────────────────────────

type Slots = boolean[][];
type Store = { id: string; name: string; weight: number; enabled: boolean; color: string };

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

// ─── StorePreferences ──────────────────────────────────────────────────────

function normalise(stores: Store[]): Store[] {
  const total = stores.filter((s) => s.enabled).reduce((a, s) => a + s.weight, 0);
  if (total <= 0) return stores;
  return stores.map((s) => (s.enabled ? { ...s, weight: s.weight / total } : s));
}

function StorePreferences() {
  const { data: session } = useSession();
  const token  = session?.user?.access_token ?? "";
  const orgId  = session?.user?.organization_id ?? "";
  const qc     = useQueryClient();

  const [stores, setStores] = useState<Store[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [dailyMax, setDailyMax] = useState<string>("");
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef({ active: false, idx: -1 });

  // ── Fetch stores + preferences ─────────────────────────────────────────

  const { data: storeList = [], isLoading: storesLoading } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: prefData, isLoading: prefsLoading } = useQuery({
    queryKey: ["myPreferences", token],
    queryFn: () => fetchMyPreferences(token),
    enabled: !!token,
  });

  const { data: me } = useQuery({
    queryKey: ["me", token],
    queryFn: () => fetchMe(token),
    enabled: !!token,
  });

  useEffect(() => {
    setDailyMax(me?.daily_hour_max != null ? String(me.daily_hour_max) : "");
  }, [me?.daily_hour_max]);

  // Merge stores + preferences once both are loaded
  useEffect(() => {
    if (!storeList.length) return;
    const prefMap = new Map((prefData ?? []).map((p) => [p.store_id, p.weight]));
    setStores(
      storeList.map((s, i) => {
        const w = prefMap.get(s.id) ?? 0;
        return { id: s.id, name: s.name, weight: w, enabled: w > 0, color: STORE_COLORS[i % STORE_COLORS.length] };
      }),
    );
    setIsDirty(false);
  }, [storeList, prefData]);

  // ── Save mutation ──────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async () => {
      const enabled = stores.filter((s) => s.enabled);
      await saveMyPreferences(
        enabled.map((s) => ({ store_id: s.id, weight: s.weight })),
        token,
      );
      const cap = dailyMax === "" ? null : Math.max(1, Math.min(24, parseInt(dailyMax, 10)));
      if (cap !== (me?.daily_hour_max ?? null)) {
        await updateMe({ daily_hour_max: cap }, token);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myPreferences", token] });
      qc.invalidateQueries({ queryKey: ["me", token] });
      setIsDirty(false);
      toast.success("偏好已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const enabled = stores.filter((s) => s.enabled);
  const isLoading = storesLoading || prefsLoading;

  // Toggle store on/off + rebalance weights
  const toggleStore = (id: string) => {
    setIsDirty(true);
    setStores((prev) => {
      const store = prev.find((s) => s.id === id)!;
      if (!store.enabled) {
        // Enabling: give it ~10% and scale others down
        const others = prev.filter((s) => s.enabled);
        const newW = others.length === 0 ? 1 : 0.1;
        const scale = others.length === 0 ? 1 : 1 - newW;
        return normalise(
          prev.map((s) => {
            if (s.id === id) return { ...s, enabled: true, weight: newW };
            if (s.enabled) return { ...s, weight: s.weight * scale };
            return s;
          }),
        );
      } else {
        // Disabling: redistribute weight to remaining
        const remaining = prev.filter((s) => s.enabled && s.id !== id);
        if (remaining.length === 0) return prev.map((s) => ({ ...s, enabled: false, weight: 0 }));
        const removedW = store.weight;
        const totalR = remaining.reduce((a, s) => a + s.weight, 0);
        return normalise(
          prev.map((s) => {
            if (s.id === id) return { ...s, enabled: false, weight: 0 };
            if (s.enabled) {
              const share = totalR > 0 ? s.weight / totalR : 1 / remaining.length;
              return { ...s, weight: s.weight + removedW * share };
            }
            return s;
          }),
        );
      }
    });
  };

  // Drag divider between enabled[idx] and enabled[idx+1]
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current.active || !barRef.current) return;
      const { left, width } = barRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - left) / width));
      const idx = dragging.current.idx;
      setIsDirty(true);
      setStores((prev) => {
        const en = prev.filter((s) => s.enabled);
        if (idx < 0 || idx >= en.length - 1) return prev;

        // Cumulative start positions
        let cum = 0;
        const starts = en.map((s) => { const v = cum; cum += s.weight; return v; });

        const bound = Math.max(
          starts[idx] + 0.02,
          Math.min(starts[idx + 1] + en[idx + 1].weight - 0.02, pct),
        );

        const newLeft = bound - starts[idx];
        const newRight = starts[idx + 1] + en[idx + 1].weight - bound;

        return prev.map((s) => {
          if (s.id === en[idx].id) return { ...s, weight: newLeft };
          if (s.id === en[idx + 1].id) return { ...s, weight: newRight };
          return s;
        });
      });
    };

    const onUp = () => { dragging.current.active = false; };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (isLoading) return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-2xl border border-white/10 p-5 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
        <div className="h-12 w-full rounded-xl bg-white/10 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-white/10 p-5 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-full rounded-xl bg-white/10 animate-pulse" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-xl space-y-5">
      {/* Weight bar */}
      {enabled.length > 0 ? (
        <div
          className="rounded-2xl border border-white/10 p-5 space-y-3"
          style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
        >
          <p className="text-sm text-white/40">拖曳分界線調整比重</p>

          {/* Bar */}
          <div
            ref={barRef}
            className="relative flex h-12 select-none overflow-hidden rounded-xl"
          >
            {enabled.map((store, i) => (
              <div
                key={store.id}
                className="relative flex items-center justify-center overflow-hidden transition-[width] duration-75"
                style={{
                  width: `${store.weight * 100}%`,
                  background: store.color,
                  minWidth: 4,
                }}
              >
                {store.weight > 0.07 && (
                  <span className="truncate px-2 text-xs font-semibold text-white drop-shadow">
                    {store.name} {Math.round(store.weight * 100)}%
                  </span>
                )}

                {/* Divider handle */}
                {i < enabled.length - 1 && (
                  <div
                    className="absolute right-0 top-0 bottom-0 z-10 flex w-5 cursor-col-resize flex-col items-center justify-end pb-1"
                    style={{
                      transform: "translateX(50%)",
                      background: "rgba(0,0,0,0.3)",
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      dragging.current = { active: true, idx: i };
                    }}
                  >
                    {/* Down-arrow affordance */}
                    <svg
                      width="10"
                      height="7"
                      viewBox="0 0 10 7"
                      className="pointer-events-none"
                    >
                      <path
                        d="M5 0L10 7H0L5 0Z"
                        fill="white"
                        fillOpacity="0.85"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-white/10 p-8 text-center"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <p className="text-sm text-white/30">請至少勾選一間門市</p>
        </div>
      )}

      {/* Store checklist */}
      <div
        className="rounded-2xl border border-white/10 p-5"
        style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
      >
        <h3 className="mb-4 text-sm font-medium text-white/50">門市清單</h3>
        <div className="grid grid-cols-2 gap-2">
          {stores.map((store) => (
            <button
              key={store.id}
              onClick={() => toggleStore(store.id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-all hover:bg-white/5",
                store.enabled && "bg-white/[0.04]",
              )}
            >
              {/* Colored checkbox */}
              <div
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all"
                style={{
                  background: store.enabled ? store.color : "transparent",
                  borderColor: store.enabled
                    ? store.color
                    : "rgba(255,255,255,0.2)",
                }}
              >
                {store.enabled && (
                  <svg
                    className="size-3 text-white"
                    fill="none"
                    viewBox="0 0 12 12"
                  >
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              <span
                className={cn(
                  "text-sm",
                  store.enabled ? "text-white" : "text-white/40",
                )}
              >
                {store.name}
              </span>

              {store.enabled && (
                <span
                  className="ml-auto rounded-md px-1.5 py-0.5 text-xs font-medium text-white/70"
                  style={{ background: `${store.color}30` }}
                >
                  {Math.round(store.weight * 100)}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Daily scheduling cap */}
      <div
        className="rounded-2xl border border-white/10 p-5"
        style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
      >
        <h3 className="mb-1 text-sm font-medium text-white/50">每日排班上限</h3>
        <p className="mb-3 text-[11px] text-white/25">自動排班時單日最多被安排的小時數，留空使用預設（8 小時）</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={24}
            value={dailyMax}
            placeholder="8"
            onChange={(e) => { setDailyMax(e.target.value); setIsDirty(true); }}
            className="h-10 w-24 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors"
            style={{ colorScheme: "dark" }}
          />
          <span className="text-sm text-white/40">小時 / 日</span>
        </div>
      </div>

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
        {isDirty ? "儲存偏好" : "已儲存"}
      </Button>
    </div>
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
