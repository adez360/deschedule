"use client";

// IDEA-14 員工入口（唯讀）：跨門市彙整「自己」的當週班次（C1），僅含已發佈／已封存班表。
// 兩種檢視模式（B1）：週曆（預設，依門市代表色 Store.color 分色）＋ 圖表（時×日格）。
// 排班作業（產生／發布／手動編輯）一律不在此入口；那些只在 ManagerSchedules（store.schedule.edit）。

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, CalendarDays, Copy, Check,
  Maximize2, Minimize2, CalendarRange, LayoutGrid, Loader2, CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DAYS, DISPLAY_HOURS } from "@/lib/constants";
import {
  fetchStores, fetchScheduleList, fetchScheduleDetail,
  type ScheduleSummaryDTO,
} from "@/lib/schedules-api";

// 門市未設代表色時的退回色盤（與 schedule-history-tab 一致）
const FALLBACK_COLORS = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#EC4899", "#0891B2", "#8B5CF6"];

// ─── Helpers ───────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getMondayOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}
function fmtRange(start: number, end: number) {
  return `${pad2(start)}:00–${pad2(end % 24)}:00`;
}

interface StoreShift { day: number; start: number; end: number; storeId: string }

// ─── Component ───────────────────────────────────────────────────────────────

export function EmployeeSchedule() {
  const { data: session } = useSession();
  const token    = session?.user?.access_token ?? "";
  const orgId    = session?.user?.organization_id ?? "";
  const userId   = session?.user?.id ?? "";
  const calToken = session?.user?.calendar_token;

  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [mode, setMode] = useState("calendar"); // 預設週曆（B1）
  const [copied, setCopied] = useState(false);

  // Fullscreen
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const weekStartStr = toLocalDateStr(weekStart);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
    }),
    [weekStart],
  );
  const weekLabel = `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`;

  const shiftWeek = (delta: number) =>
    setWeekStart((prev) => { const d = new Date(prev); d.setDate(d.getDate() + delta * 7); return d; });

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const storeMeta = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    stores.forEach((s, i) =>
      m.set(s.id, { name: s.name, color: s.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }),
    );
    return m;
  }, [stores]);

  // schedule lists per store
  const listQueries = useQueries({
    queries: stores.map((s) => ({
      queryKey: ["scheduleList", s.id],
      queryFn: () => fetchScheduleList(s.id, token),
      enabled: !!token,
    })),
  });
  const listsLoading = listQueries.some((q) => q.isLoading);

  // 本週、已發佈/已封存（員工看不到草稿）的班表 summary
  const weekSummaries: ScheduleSummaryDTO[] = useMemo(() => {
    const out: ScheduleSummaryDTO[] = [];
    listQueries.forEach((q) => {
      (q.data ?? []).forEach((sc) => {
        if (sc.week_start === weekStartStr && sc.status !== "draft") out.push(sc);
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQueries.map((q) => q.dataUpdatedAt).join(","), weekStartStr]);

  const detailQueries = useQueries({
    queries: weekSummaries.map((sc) => ({
      queryKey: ["scheduleDetail", sc.id],
      queryFn: () => fetchScheduleDetail(sc.id, token),
      enabled: !!token,
    })),
  });
  const detailsLoading = detailQueries.some((q) => q.isLoading);

  // 我本週的班次（跨門市），合併連續時段為班別
  const myShifts: StoreShift[] = useMemo(() => {
    const shifts: StoreShift[] = [];
    detailQueries.forEach((q) => {
      const detail = q.data;
      if (!detail) return;
      const mine = detail.assignments.filter((a) => a.user_id === userId);
      if (mine.length === 0) return;
      const byDay = new Map<number, typeof mine>();
      for (const a of mine) { const arr = byDay.get(a.day) ?? []; arr.push(a); byDay.set(a.day, arr); }
      for (const [day, da] of byDay) {
        da.sort((a, b) => a.hour - b.hour);
        let i = 0;
        while (i < da.length) {
          let j = i + 1;
          while (j < da.length && da[j].hour === da[j - 1].hour + 1) j++;
          shifts.push({ day, start: da[i].hour, end: da[j - 1].hour + 1, storeId: detail.store_id });
          i = j;
        }
      }
    });
    return shifts;
  }, [detailQueries, userId]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeStoreIds = useMemo(() => {
    const ids = new Set(myShifts.map((s) => s.storeId));
    return stores.filter((s) => ids.has(s.id)).map((s) => s.id);
  }, [myShifts, stores]);

  const shiftsByStoreDay = useMemo(() => {
    const m = new Map<string, StoreShift[]>(); // `${storeId}-${day}`
    for (const s of myShifts) {
      const k = `${s.storeId}-${s.day}`;
      const arr = m.get(k) ?? []; arr.push(s); m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.start - b.start);
    return m;
  }, [myShifts]);

  // 圖表模式：每個 day-hour 格子屬於哪個門市（+該班別時段，供 tooltip）
  const cellStore = useMemo(() => {
    const m = new Map<string, { storeId: string; start: number; end: number }>();
    for (const s of myShifts) {
      for (let h = s.start; h < s.end; h++) m.set(`${s.day}-${h}`, { storeId: s.storeId, start: s.start, end: s.end });
    }
    return m;
  }, [myShifts]);

  const totalHours = useMemo(() => myShifts.reduce((sum, s) => sum + (s.end - s.start), 0), [myShifts]);

  const loading = listsLoading || detailsLoading;
  const isEmpty = !loading && myShifts.length === 0;

  // ── Calendar subscription ──────────────────────────────────────────────────

  const calendarUrl = calToken
    ? `webcal://localhost:8000/api/calendar/${calToken}/personal.ics`
    : null;
  const copyUrl = () => {
    if (!calendarUrl) return;
    navigator.clipboard.writeText(calendarUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">我的班表</h1>
          <p className="mt-1 text-sm text-white/40">檢視個人各門市的當週班次</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Week nav */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 h-9">
            <button onClick={() => shiftWeek(-1)}
              className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="上一週">
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 text-sm text-white/70 min-w-[100px] text-center [font-variant-numeric:tabular-nums]">{weekLabel}</span>
            <button onClick={() => shiftWeek(1)}
              className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="下一週">
              <ChevronRight className="size-4" />
            </button>
          </div>

          {!loading && (
            <span className="text-xs text-purple-300 [font-variant-numeric:tabular-nums]">本週 {totalHours} 小時</span>
          )}

          {/* Calendar subscription */}
          <Popover>
            <PopoverTrigger className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors">
              <CalendarDays className="size-4" />
              訂閱日曆
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 border-white/10 p-4 space-y-3"
              style={{ background: "rgba(13,13,26,0.95)", backdropFilter: "blur(16px)" }}
            >
              <div>
                <p className="text-sm font-medium text-white">個人班表訂閱</p>
                <p className="text-xs text-white/40 mt-0.5">將此連結加入 Google Calendar、Apple Calendar 等日曆 App</p>
              </div>
              {calendarUrl ? (
                <>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[11px] text-white/50 break-all font-mono leading-relaxed">{calendarUrl}</p>
                  </div>
                  <Button
                    className="w-full gap-2 border-0 text-white hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)" }}
                    onClick={copyUrl}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "已複製！" : "複製訂閱連結"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-white/30">載入中…</p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Views — fullscreen container */}
      <div
        ref={containerRef}
        className={cn(isFullscreen && "flex flex-col")}
        style={isFullscreen ? { height: "100dvh", background: "#0D0D1A", padding: "16px", gap: "12px" } : undefined}
      >
        <Tabs value={mode} onValueChange={setMode} className={cn(isFullscreen && "flex flex-col flex-1 min-h-0")}>
          <div className="flex items-center gap-2">
            <TabsList className="h-auto gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              <TabsTrigger
                value="calendar"
                className="gap-1.5 rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none">
                <CalendarRange className="size-3.5" /> 週曆
              </TabsTrigger>
              <TabsTrigger
                value="chart"
                className="gap-1.5 rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none">
                <LayoutGrid className="size-3.5" /> 圖表
              </TabsTrigger>
            </TabsList>
            <button
              onClick={toggleFullscreen}
              className={cn(
                "ml-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-all",
                isFullscreen
                  ? "bg-white/[0.08] border border-white/[0.15] text-white/65 hover:bg-white/[0.13]"
                  : "bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/32 hover:text-purple-200",
              )}
              aria-label={isFullscreen ? "退出全螢幕" : "全螢幕"}
            >
              {isFullscreen
                ? <><Minimize2 className="size-3.5" /><span>縮小</span></>
                : <><Maximize2 className="size-3.5" /><span>全螢幕</span></>}
            </button>

            {/* Store legend */}
            {!loading && activeStoreIds.length > 0 && (
              <div className="ml-auto flex items-center gap-3 flex-wrap">
                {activeStoreIds.map((sid) => {
                  const m = storeMeta.get(sid);
                  return (
                    <div key={sid} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ background: m?.color ?? "#888" }} />
                      <span className="text-[11px] text-white/45">{m?.name ?? "未知門市"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 週曆 ── */}
          <TabsContent value="calendar" className={cn("mt-5", isFullscreen && "mt-3 flex-1 min-h-0")}>
            {loading ? (
              <LoadingCard />
            ) : isEmpty ? (
              <EmptyCard />
            ) : (
              <CalendarView
                activeStoreIds={activeStoreIds}
                storeMeta={storeMeta}
                shiftsByStoreDay={shiftsByStoreDay}
                weekDates={weekDates}
                isFullscreen={isFullscreen}
              />
            )}
          </TabsContent>

          {/* ── 圖表 ── */}
          <TabsContent value="chart" className={cn("mt-5", isFullscreen && "mt-3 flex-1 min-h-0")}>
            {loading ? (
              <LoadingCard />
            ) : isEmpty ? (
              <EmptyCard />
            ) : (
              <ChartView
                cellStore={cellStore}
                storeMeta={storeMeta}
                weekDates={weekDates}
                isFullscreen={isFullscreen}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Sub-views ───────────────────────────────────────────────────────────────

function LoadingCard() {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-white/10 py-16"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <Loader2 className="size-5 text-white/30 animate-spin" />
    </div>
  );
}

function EmptyCard() {
  return (
    <div className="rounded-2xl border border-white/10 p-12 text-center"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <CalendarClock className="mx-auto size-8 text-white/20 mb-3" />
      <p className="text-sm text-white/30">本週尚無已發佈的班表</p>
    </div>
  );
}

function CalendarView({
  activeStoreIds, storeMeta, shiftsByStoreDay, weekDates, isFullscreen,
}: {
  activeStoreIds: string[];
  storeMeta: Map<string, { name: string; color: string }>;
  shiftsByStoreDay: Map<string, StoreShift[]>;
  weekDates: Date[];
  isFullscreen: boolean;
}) {
  const cols = "10rem repeat(7, minmax(104px, 1fr))";
  const todayStr = toLocalDateStr(new Date());
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10"
      style={{
        background: "rgba(255,255,255,0.03)",
        maxHeight: isFullscreen ? "calc(100dvh - 90px)" : undefined,
        overflowY: isFullscreen ? "auto" : undefined,
      }}>
      <div className={cn("min-w-[760px]", isFullscreen && "max-w-6xl mx-auto")}>
        {/* Header */}
        <div className="grid sticky top-0 z-10" style={{ gridTemplateColumns: cols }}>
          <div className="border-b border-r border-white/10 px-4 py-3 text-xs text-white/30 bg-[rgba(13,13,26,0.9)]">
            門市 / 星期
          </div>
          {DAYS.map((d, i) => {
            const isToday = toLocalDateStr(weekDates[i]) === todayStr;
            return (
              <div key={d}
                className="border-b border-r border-white/10 py-3 text-center last:border-r-0 bg-[rgba(13,13,26,0.9)]">
                <div className={cn("text-sm font-medium", isToday ? "text-purple-300" : "text-white/70")}>{d}</div>
                <div className={cn("text-xs [font-variant-numeric:tabular-nums]", isToday ? "text-purple-400/70" : "text-white/30")}>{fmtDate(weekDates[i])}</div>
              </div>
            );
          })}
        </div>

        {/* Rows — one per store */}
        {activeStoreIds.map((sid) => {
          const meta = storeMeta.get(sid);
          const color = meta?.color ?? "#888";
          return (
            <div key={sid}
              className="grid border-b border-white/[0.06] last:border-b-0"
              style={{ gridTemplateColumns: cols }}>
              {/* Store name */}
              <div className="flex items-center gap-2 border-r border-white/10 px-4 py-3"
                style={{ borderLeft: `3px solid ${color}` }}>
                <span className="size-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-sm font-medium text-white/85 truncate">{meta?.name ?? "未知門市"}</span>
              </div>
              {/* Day cells */}
              {DAYS.map((_, di) => {
                const shifts = shiftsByStoreDay.get(`${sid}-${di}`) ?? [];
                return (
                  <div key={di}
                    className="border-r border-white/[0.06] last:border-r-0 p-1.5 flex flex-col gap-1">
                    {shifts.map((sh, si) => (
                      <div key={si}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-center [font-variant-numeric:tabular-nums]"
                        style={{ background: `${color}26`, color, border: `1px solid ${color}55` }}>
                        {fmtRange(sh.start, sh.end)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartView({
  cellStore, storeMeta, weekDates, isFullscreen,
}: {
  cellStore: Map<string, { storeId: string; start: number; end: number }>;
  storeMeta: Map<string, { name: string; color: string }>;
  weekDates: Date[];
  isFullscreen: boolean;
}) {
  const cols = "4rem repeat(7, minmax(96px, 1fr))";
  return (
    <TooltipProvider delay={200}>
      <div className="overflow-auto rounded-2xl border border-white/10"
        style={{
          background: "rgba(255,255,255,0.03)",
          maxHeight: isFullscreen ? "calc(100dvh - 90px)" : "calc(100dvh - 280px)",
          minHeight: 200,
        }}>
        <div className={cn("min-w-[700px]", isFullscreen && "max-w-6xl mx-auto")}>
          {/* Header */}
          <div className="grid border-b border-white/10 sticky top-0 z-10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm"
            style={{ gridTemplateColumns: cols }}>
            <div />
            {DAYS.map((d, i) => (
              <div key={d} className="py-2 text-center border-r border-white/[0.06] last:border-r-0">
                <div className="text-xs font-medium text-white/60">{d}</div>
                <div className="text-[10px] text-white/25 [font-variant-numeric:tabular-nums]">{fmtDate(weekDates[i])}</div>
              </div>
            ))}
          </div>
          {/* Rows — one per display hour */}
          {DISPLAY_HOURS.map((h) => (
            <div key={h} className="grid border-b border-white/[0.05] last:border-b-0"
              style={{ gridTemplateColumns: cols }}>
              <div className="flex items-center justify-end pr-2 text-[10px] text-white/35 py-1.5 [font-variant-numeric:tabular-nums]">
                {pad2(h)}:00
              </div>
              {DAYS.map((_, di) => {
                const hit = cellStore.get(`${di}-${h}`);
                const meta = hit ? storeMeta.get(hit.storeId) : null;
                const block = (
                  <div className="h-8 rounded"
                    style={hit && meta
                      ? { background: `${meta.color}59`, border: `1px solid ${meta.color}` }
                      : { background: "rgba(255,255,255,0.03)" }}
                  />
                );
                return (
                  <div key={di} className="border-r border-white/[0.06] last:border-r-0 p-[3px]">
                    {hit && meta ? (
                      <Tooltip>
                        <TooltipTrigger render={block} />
                        <TooltipContent side="top" className="text-xs">
                          {meta.name} · {DAYS[di]} {fmtRange(hit.start, hit.end)}
                        </TooltipContent>
                      </Tooltip>
                    ) : block}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
