"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Copy, Maximize2, Minimize2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchAvailability, saveAvailability } from "@/lib/availability-api";
import { fetchMyPreferences, saveMyPreferences } from "@/lib/preferences-api";
import { fetchStores } from "@/lib/schedules-api";
import { DAYS, DISPLAY_HOURS } from "@/lib/constants";

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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

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

  // Fullscreen — must be declared before any useEffect that references it
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Scroll affordance
  const [isAtBottom, setIsAtBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-evaluate when fullscreen changes (height changes → may no longer need to scroll)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, [isFullscreen]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  // All drag state in refs → no stale closures, no extra re-renders
  const drag = useRef({
    active: false,
    mode: "on" as "on" | "off",
    origin: [0, 0] as [number, number],
    end: [0, 0] as [number, number],
  });
  const [renderSeed, setRenderSeed] = useState(0);
  const tick = () => setRenderSeed((n) => n + 1);

  // Latest slots in a ref so the window pointerup handler is never stale
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const setWeekSlotsRef = useRef(setWeekSlots);
  setWeekSlotsRef.current = setWeekSlots;
  const setDirtyWeeksRef = useRef(setDirtyWeeks);
  setDirtyWeeksRef.current = setDirtyWeeks;
  const activeWeekRef = useRef(activeWeek);
  activeWeekRef.current = activeWeek;

  // Commit on global pointer-up (handles releasing outside the grid)
  // origin/end store [day, rowIdx] — rowIdx is the display row (0-23), not actual hour
  useEffect(() => {
    const commit = () => {
      if (!drag.current.active) return;
      const [d0, r0] = drag.current.origin;
      const [d1, r1] = drag.current.end;
      const base = slotsRef.current;
      const next = base.map((r) => [...r]);
      for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d++)
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
          next[d][DISPLAY_HOURS[r]] = drag.current.mode === "on";
      drag.current.active = false;
      setWeekSlotsRef.current((p) => ({ ...p, [activeWeekRef.current]: next }));
      setDirtyWeeksRef.current((prev) => new Set(prev).add(activeWeekRef.current));
      setRenderSeed((n) => n + 1);
    };
    window.addEventListener("pointerup", commit);
    return () => window.removeEventListener("pointerup", commit);
  }, []);

  // Compute preview during drag (called at render time from refs)
  const getPreview = () => {
    if (!drag.current.active) return null;
    const [d0, r0] = drag.current.origin;
    const [d1, r1] = drag.current.end;
    return {
      dMin: Math.min(d0, d1),
      dMax: Math.max(d0, d1),
      rMin: Math.min(r0, r1),
      rMax: Math.max(r0, r1),
      mode: drag.current.mode,
    };
  };
  const preview = getPreview();
  void renderSeed; // consumed for re-render

  const cellStyle = (day: number, hour: number, rowIdx: number) => {
    const inPreview =
      preview &&
      day >= preview.dMin &&
      day <= preview.dMax &&
      rowIdx >= preview.rMin &&
      rowIdx <= preview.rMax;

    if (inPreview && preview.mode === "on")
      return {
        background: "rgba(99,102,241,0.45)",
        border: "1px solid rgba(99,102,241,0.65)",
      };
    if (inPreview && preview.mode === "off")
      return {
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
      };
    if (slots[day][hour])
      return {
        background: "rgba(124,58,237,0.55)",
        border: "1px solid rgba(139,92,246,0.5)",
      };
    return {
      background: (hour >= 8 && hour <= 14)
        ? "rgba(255,255,255,0.07)"    // 08–14
        : (hour >= 15 && hour <= 22)
          ? "rgba(255,255,255,0.045)" // 15–22
          : "rgba(255,255,255,0.055)", // 23–07
      border: "1px solid rgba(255,255,255,0.13)",
    };
  };

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

      {/* Grid card */}
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden border border-white/10",
          isFullscreen ? "rounded-none" : "rounded-2xl",
        )}
        style={{
          background: isFullscreen ? "#0D0D1A" : "rgba(255,255,255,0.03)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Scroll affordance — bottom fade + hint, auto-hides when scrolled near bottom */}
        {!isAtBottom && (
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center justify-end pb-2"
            style={{
              height: 56,
              background: "linear-gradient(to bottom, transparent, rgba(13,13,26,0.92))",
            }}
          >
            <span className="text-[10px] text-white/40 animate-bounce flex items-center gap-1">
              ↓ 滑動查看更多時段
            </span>
          </div>
        )}

        {/* Scrollable area — header is sticky inside so scrollbar width stays consistent */}
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{
            maxHeight: isFullscreen ? "calc(100dvh - 45px)" : "calc(100dvh - 390px)",
            minHeight: 200,
            touchAction: "pan-y",
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
          }}
          onPointerMove={(e) => {
            if (!drag.current.active) return;
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (!el) return;
            const cell = el.closest("[data-day]") as HTMLElement | null;
            if (!cell) return;
            const d = Number(cell.dataset.day);
            const r = Number(cell.dataset.row);
            if (!isNaN(d) && !isNaN(r) &&
                (drag.current.end[0] !== d || drag.current.end[1] !== r)) {
              drag.current.end = [d, r];
              tick();
            }
          }}
        >
          {/* In fullscreen: center content with max-width so cells don't become too wide */}
          <div className={cn(isFullscreen && "max-w-4xl mx-auto w-full")}>
          {/* Sticky day header — inside scroll container so scrollbar width is shared */}
          <div className="grid grid-cols-[3rem_repeat(7,1fr)_0.75rem] sticky top-0 z-10 border-b border-white/10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm">
            {/* Fullscreen button in first column */}
            <button
              onClick={toggleFullscreen}
              className={cn(
                "flex items-center justify-center gap-1 px-1.5 py-1.5 transition-all",
                isFullscreen
                  ? "rounded-md bg-white/[0.08] border border-white/[0.15] text-white/65 hover:bg-white/[0.13]"
                  : "rounded-md rounded-tl-2xl bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/32 hover:text-purple-200",
              )}
              aria-label={isFullscreen ? "退出全螢幕" : "全螢幕"}
            >
              {isFullscreen
                ? <><Minimize2 className="size-3" /><span className="text-[9px] leading-none">縮小</span></>
                : <><Maximize2 className="size-3" /><span className="text-[9px] leading-none">全螢</span></>}
            </button>
            {DAYS.map((d) => (
              <div key={d} className="py-3 text-center text-sm font-medium text-white/60">
                {d}
              </div>
            ))}
            <div />{/* right scroll zone */}
          </div>

          {DISPLAY_HOURS.map((hour, rowIdx) => (
            <div
              key={rowIdx}
              className={cn(
                "grid grid-cols-[3rem_repeat(7,1fr)_0.75rem]",
                [7, 15, 23].includes(hour) && "border-t border-white/[0.08]",
              )}
            >
              {/* Time label */}
              <div className={cn(
                "flex items-center justify-end pr-2 text-[10px]",
                [7, 15, 23].includes(hour) ? "text-white/50" : "text-transparent",
              )}>
                {`${pad2(hour)}:00`}
              </div>

              {/* Cells */}
              {DAYS.map((_, day) => (
                <div
                  key={day}
                  data-day={day}
                  data-row={rowIdx}
                  className={cn("m-[2px] h-7 select-none rounded-md transition-colors duration-75", isLocked ? "cursor-not-allowed" : "cursor-pointer")}
                  style={{ ...cellStyle(day, hour, rowIdx), touchAction: "none" }}
                  onPointerDown={(e) => {
                    if (isLocked) return;
                    e.preventDefault();
                    drag.current = {
                      active: true,
                      mode: slots[day][hour] ? "off" : "on",
                      origin: [day, rowIdx],
                      end: [day, rowIdx],
                    };
                    tick();
                  }}
                  role="button"
                  aria-pressed={slots[day][hour]}
                  aria-label={`${DAYS[day]}曜 ${pad2(hour)}:00`}
                />
              ))}
              <div />{/* right scroll zone */}
            </div>
          ))}
          </div>{/* end fullscreen max-width wrapper */}
        </div>
      </div>

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
    mutationFn: () => {
      const enabled = stores.filter((s) => s.enabled);
      return saveMyPreferences(
        enabled.map((s) => ({ store_id: s.id, weight: s.weight })),
        token,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myPreferences", token] });
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
