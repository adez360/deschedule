"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Copy, Loader2, Lock, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AvailabilityGrid } from "@/components/shared/availability-grid";
import { fetchUserAvailabilityRange, saveUserAvailability } from "@/lib/availability-api";

type Slots = boolean[][];

const emptySlots = (): Slots => Array.from({ length: 7 }, () => Array(24).fill(false));

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
  const isDirty = dirtyWeeks.has(activeWeek);
  const slots = weekSlots[activeWeek] ?? emptySlots();

  const setSlots = useCallback((s: Slots) => {
    setWeekSlots((p) => ({ ...p, [activeWeek]: s }));
    setDirtyWeeks((prev) => new Set(prev).add(activeWeek));
  }, [activeWeek]);

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

      <AvailabilityGrid
        slots={slots}
        onChange={setSlots}
        editable={editable && !isLocked}
        maxHeight="calc(100dvh - 420px)"
      />

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
