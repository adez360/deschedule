"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { CalendarClock, Loader2, Archive, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DAYS } from "@/lib/constants";
import {
  fetchScheduleList, fetchScheduleDetail,
  type StoreDTO, type ScheduleSummaryDTO,
} from "@/lib/schedules-api";

const STORE_COLORS = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#EC4899", "#0891B2"];

const HISTORY_WEEKS = 12; // most-recent schedules to inspect across the org

function pad2(n: number) { return String(n).padStart(2, "0"); }

function fmtWeek(weekStart: string) {
  const [y, m, d] = weekStart.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
}

interface Shift { day: number; start: number; end: number; storeId: string }

export function ScheduleHistoryTab({
  userId, token, stores,
}: {
  userId: string;
  token: string;
  stores: StoreDTO[];
}) {
  const storeMeta = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    stores.forEach((s, i) => m.set(s.id, { name: s.name, color: STORE_COLORS[i % STORE_COLORS.length] }));
    return m;
  }, [stores]);

  // 1) schedule lists per store
  const listQueries = useQueries({
    queries: stores.map((s) => ({
      queryKey: ["scheduleList", s.id],
      queryFn: () => fetchScheduleList(s.id, token),
      enabled: !!token,
    })),
  });

  const listsLoading = listQueries.some((q) => q.isLoading);

  // most-recent published/archived schedules across the org
  const recent: ScheduleSummaryDTO[] = useMemo(() => {
    const all: ScheduleSummaryDTO[] = [];
    listQueries.forEach((q) => {
      (q.data ?? []).forEach((sc) => { if (sc.status !== "draft") all.push(sc); });
    });
    return all
      .sort((a, b) => b.week_start.localeCompare(a.week_start))
      .slice(0, HISTORY_WEEKS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQueries.map((q) => q.dataUpdatedAt).join(",")]);

  // 2) details for those schedules
  const detailQueries = useQueries({
    queries: recent.map((sc) => ({
      queryKey: ["scheduleDetail", sc.id],
      queryFn: () => fetchScheduleDetail(sc.id, token),
      enabled: !!token,
    })),
  });

  const detailsLoading = detailQueries.some((q) => q.isLoading);

  // 3) group this user's shifts by week_start
  const weeks = useMemo(() => {
    const byWeek = new Map<string, { status: ScheduleSummaryDTO["status"]; shifts: Shift[] }>();

    detailQueries.forEach((q) => {
      const detail = q.data;
      if (!detail) return;
      const mine = detail.assignments.filter((a) => a.user_id === userId);
      if (mine.length === 0) return;

      // group by day → contiguous blocks
      const byDay = new Map<number, typeof mine>();
      for (const a of mine) {
        const arr = byDay.get(a.day) ?? []; arr.push(a); byDay.set(a.day, arr);
      }
      const shifts: Shift[] = [];
      for (const [day, dayAssigns] of byDay) {
        dayAssigns.sort((a, b) => a.hour - b.hour);
        let i = 0;
        while (i < dayAssigns.length) {
          let j = i + 1;
          while (j < dayAssigns.length && dayAssigns[j].hour === dayAssigns[j - 1].hour + 1) j++;
          shifts.push({ day, start: dayAssigns[i].hour, end: dayAssigns[j - 1].hour + 1, storeId: detail.store_id });
          i = j;
        }
      }
      const entry = byWeek.get(detail.week_start) ?? { status: detail.status, shifts: [] };
      entry.shifts.push(...shifts);
      byWeek.set(detail.week_start, entry);
    });

    return Array.from(byWeek.entries())
      .map(([weekStart, v]) => ({
        weekStart,
        status: v.status,
        shifts: v.shifts.sort((a, b) => a.day - b.day || a.start - b.start),
        hours: v.shifts.reduce((s, sh) => s + (sh.end - sh.start), 0),
      }))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [detailQueries, userId]);

  const loading = listsLoading || detailsLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 py-16" style={{ background: "rgba(255,255,255,0.03)" }}>
        <Loader2 className="size-5 text-white/30 animate-spin" />
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 p-10 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
        <CalendarClock className="mx-auto size-8 text-white/20 mb-3" />
        <p className="text-sm text-white/30">近期沒有已發佈的班表記錄</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {weeks.map((w) => (
        <div key={w.weekStart} className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white/80 [font-variant-numeric:tabular-nums]">{fmtWeek(w.weekStart)}</span>
              {w.status === "archived" ? (
                <Badge className="border-white/15 bg-white/8 text-white/45 text-[10px] gap-1"><Archive className="size-2.5" />已封存</Badge>
              ) : (
                <Badge className="border-emerald-500/30 bg-emerald-600/15 text-emerald-300 text-[10px] gap-1"><Send className="size-2.5" />已發佈</Badge>
              )}
            </div>
            <span className="text-xs text-purple-300 [font-variant-numeric:tabular-nums]">{w.hours} 小時</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {w.shifts.map((sh, i) => {
              const meta = storeMeta.get(sh.storeId);
              return (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-8 flex-shrink-0 text-xs font-medium text-white/60">週{DAYS[sh.day]}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-white"
                    style={{ background: `${meta?.color ?? "#666"}28`, color: meta?.color ?? "#aaa" }}>
                    <span className="size-1.5 rounded-full" style={{ background: meta?.color ?? "#888" }} />
                    {meta?.name ?? "未知門市"}
                  </span>
                  <span className={cn("ml-auto text-sm text-white/75 [font-variant-numeric:tabular-nums]")}>
                    {pad2(sh.start)}:00 – {pad2(sh.end === 24 ? 0 : sh.end)}:00
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
