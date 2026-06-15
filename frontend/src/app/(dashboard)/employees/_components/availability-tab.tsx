"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Copy, Loader2, Lock, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DAYS, DISPLAY_HOURS } from "@/lib/constants";
import { fetchUserAvailabilityRange, saveUserAvailability } from "@/lib/availability-api";

type Slots = boolean[][];

const emptySlots = (): Slots => Array.from({ length: 7 }, () => Array(24).fill(false));
const pad2 = (n: number) => String(n).padStart(2, "0");

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

export function AvailabilityTab({
  userId, token, editable,
}: {
  userId: string;
  token: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const weeks = getWeeks();
  const fromDate = weeks[0].date;

  const [activeWeek, setActiveWeek] = useState(weeks[0].date);
  const [weekSlots, setWeekSlots] = useState<Record<string, Slots>>({});
  const [dirtyWeeks, setDirtyWeeks] = useState<Set<string>>(new Set());
  const [lockedWeeks, setLockedWeeks] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["userAvailability", userId, fromDate],
    queryFn: () => fetchUserAvailabilityRange(userId, fromDate, token),
    enabled: !!userId && !!token,
  });

  // Reset local state when switching employees
  useEffect(() => {
    setWeekSlots({});
    setDirtyWeeks(new Set());
    setActiveWeek(weeks[0].date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!data) return;
    const loaded: Record<string, Slots> = {};
    const locked = new Set<string>();
    data.forEach((av) => {
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
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => saveUserAvailability(userId, activeWeek, weekSlots[activeWeek] ?? emptySlots(), token),
    onSuccess: () => {
      setDirtyWeeks((p) => { const n = new Set(p); n.delete(activeWeek); return n; });
      qc.invalidateQueries({ queryKey: ["userAvailability", userId, fromDate] });
      toast.success("時段已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const isLocked = lockedWeeks.has(activeWeek);
  const readOnly = !editable || isLocked;
  const isDirty = dirtyWeeks.has(activeWeek);
  const slots = weekSlots[activeWeek] ?? emptySlots();

  const setSlots = useCallback((s: Slots) => {
    setWeekSlots((p) => ({ ...p, [activeWeek]: s }));
    setDirtyWeeks((prev) => new Set(prev).add(activeWeek));
  }, [activeWeek]);

  // ── Drag state (refs → no stale closures) ──────────────────────────────────
  const drag = useRef({ active: false, mode: "on" as "on" | "off", origin: [0, 0] as [number, number], end: [0, 0] as [number, number] });
  const [, force] = useState(0);
  const tick = () => force((n) => n + 1);

  const slotsRef = useRef(slots); slotsRef.current = slots;
  const activeWeekRef = useRef(activeWeek); activeWeekRef.current = activeWeek;
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly;

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
      setWeekSlots((p) => ({ ...p, [activeWeekRef.current]: next }));
      setDirtyWeeks((prev) => new Set(prev).add(activeWeekRef.current));
      force((n) => n + 1);
    };
    window.addEventListener("pointerup", commit);
    return () => window.removeEventListener("pointerup", commit);
  }, []);

  const preview = drag.current.active
    ? {
        dMin: Math.min(drag.current.origin[0], drag.current.end[0]),
        dMax: Math.max(drag.current.origin[0], drag.current.end[0]),
        rMin: Math.min(drag.current.origin[1], drag.current.end[1]),
        rMax: Math.max(drag.current.origin[1], drag.current.end[1]),
        mode: drag.current.mode,
      }
    : null;

  const cellStyle = (day: number, hour: number, rowIdx: number) => {
    const inPreview = preview && day >= preview.dMin && day <= preview.dMax && rowIdx >= preview.rMin && rowIdx <= preview.rMax;
    if (inPreview && preview.mode === "on")
      return { background: "rgba(99,102,241,0.45)", border: "1px solid rgba(99,102,241,0.65)" };
    if (inPreview && preview.mode === "off")
      return { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" };
    if (slots[day][hour])
      return { background: "rgba(124,58,237,0.55)", border: "1px solid rgba(139,92,246,0.5)" };
    return {
      background: (hour >= 8 && hour <= 14) ? "rgba(255,255,255,0.07)"
        : (hour >= 15 && hour <= 22) ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.055)",
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
            const dirty = dirtyWeeks.has(w.date);
            return (
              <button
                key={w.date}
                onClick={() => setActiveWeek(w.date)}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  activeWeek === w.date ? "bg-purple-600/40 text-white" : "text-white/40 hover:text-white/70",
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
          {!editable && <Badge className="border-white/15 bg-white/8 text-white/50 text-xs gap-1"><Eye className="size-2.5" />唯讀</Badge>}
          {isLocked && <Badge className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs gap-1"><Lock className="size-2.5" />已鎖定</Badge>}
          <Badge className="border-purple-500/30 bg-purple-600/20 text-purple-300">已選 {selectedCount} 小時</Badge>
        </div>
      </div>

      {/* Grid */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10"
        style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(100dvh - 420px)", minHeight: 200, touchAction: "pan-y" }}
          onPointerMove={(e) => {
            if (!drag.current.active) return;
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const cell = el?.closest("[data-day]") as HTMLElement | null;
            if (!cell) return;
            const d = Number(cell.dataset.day);
            const r = Number(cell.dataset.row);
            if (!isNaN(d) && !isNaN(r) && (drag.current.end[0] !== d || drag.current.end[1] !== r)) {
              drag.current.end = [d, r];
              tick();
            }
          }}
        >
          {/* Sticky header */}
          <div className="grid grid-cols-[3rem_repeat(7,1fr)] sticky top-0 z-10 border-b border-white/10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm">
            <div />
            {DAYS.map((d) => (
              <div key={d} className="py-2.5 text-center text-xs font-medium text-white/60">{d}</div>
            ))}
          </div>

          {DISPLAY_HOURS.map((hour, rowIdx) => (
            <div key={rowIdx} className={cn("grid grid-cols-[3rem_repeat(7,1fr)]", [7, 15, 23].includes(hour) && "border-t border-white/[0.08]")}>
              <div className={cn("flex items-center justify-end pr-2 text-[10px]", [7, 15, 23].includes(hour) ? "text-white/50" : "text-transparent")}>
                {`${pad2(hour)}:00`}
              </div>
              {DAYS.map((_, day) => (
                <div
                  key={day}
                  data-day={day}
                  data-row={rowIdx}
                  className={cn("m-[2px] h-6 select-none rounded transition-colors duration-75", readOnly ? "cursor-default" : "cursor-pointer")}
                  style={{ ...cellStyle(day, hour, rowIdx), touchAction: "none" }}
                  onPointerDown={(e) => {
                    if (readOnlyRef.current) return;
                    e.preventDefault();
                    drag.current = { active: true, mode: slots[day][hour] ? "off" : "on", origin: [day, rowIdx], end: [day, rowIdx] };
                    tick();
                  }}
                  role="button"
                  aria-pressed={slots[day][hour]}
                  aria-label={`${DAYS[day]}曜 ${pad2(hour)}:00`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            className="gap-2 border-0 text-white hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || isLocked || !isDirty}
          >
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isDirty ? "儲存時段" : "已儲存"}
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
            onClick={() => { setSlots(emptySlots()); toast.info("已清除時段"); }}
            disabled={isLocked}
          >
            <RefreshCw className="size-4" />清除
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
            onClick={() => {
              if (isLocked) return;
              const idx = weeks.findIndex((w) => w.date === activeWeek);
              const prevSlots = idx > 0 ? weekSlots[weeks[idx - 1].date] : undefined;
              if (prevSlots) { setSlots(prevSlots.map((r) => [...r])); toast.success("已從上週複製"); }
              else toast.info("上週沒有資料可複製");
            }}
            disabled={isLocked}
          >
            <Copy className="size-4" />從上週複製
          </Button>
        </div>
      )}
    </div>
  );
}
