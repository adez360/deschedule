"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  useSensor, useSensors, PointerSensor, TouchSensor,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, Zap, Send, Archive, CalendarDays, Copy, Check,
  Loader2, Maximize2, Minimize2, Trash2, Undo2, GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  fetchStores, fetchOrgUsers, fetchScheduleList, fetchScheduleDetail,
  generateSchedule, updateScheduleStatus, createAssignment, deleteAssignment,
  buildEmployeeRows, buildActual,
  type StoreDTO, type EmployeeRow, type AssignmentDTO, type UserDTO,
} from "@/lib/schedules-api";
import { fetchUserAvailability } from "@/lib/availability-api";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAYS = ["一", "二", "三", "四", "五", "六", "日"];

const HEAT_HOURS = Array.from({ length: 24 }, (_, i) => (i + 7) % 24);

const STATUS_CONFIG = {
  draft:     { label: "草稿",   cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" },
  published: { label: "已發布", cls: "border-green-500/30  bg-green-500/10  text-green-400"  },
  archived:  { label: "已封存", cls: "border-white/10       bg-white/5       text-white/40"   },
} as const;

const SHIFT_COLORS = [
  { bg: "rgba(124,58,237,0.35)",  border: "rgba(139,92,246,0.5)"  },
  { bg: "rgba(37,99,235,0.35)",   border: "rgba(96,165,250,0.5)"  },
  { bg: "rgba(5,150,105,0.35)",   border: "rgba(52,211,153,0.5)"  },
  { bg: "rgba(217,119,6,0.35)",   border: "rgba(251,191,36,0.5)"  },
  { bg: "rgba(236,72,153,0.35)",  border: "rgba(244,114,182,0.5)" },
  { bg: "rgba(8,145,178,0.35)",   border: "rgba(34,211,238,0.5)"  },
  { bg: "rgba(139,92,246,0.35)",  border: "rgba(167,139,250,0.5)" },
];

// Mock demand (to be replaced when DemandTemplate API is connected)
const DEMAND: number[][] = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => {
    if (h < 9 || h >= 22) return 0;
    if (d >= 5) return h >= 11 && h < 21 ? 2 : 1;
    return h >= 9 && h < 18 ? 3 : 2;
  })
);

// ─── Helpers ───────────────────────────────────────────────────────────────

function getMondayOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtShift(start: number, end: number) {
  return `${pad2(start)}:00–${pad2(end % 24 || 0)}:00`;
}

function coverageColor(actual: number, demand: number) {
  if (demand === 0) return "rgba(255,255,255,0.03)";
  const r = actual / demand;
  if (r < 0.5)  return "rgba(239,68,68,0.35)";
  if (r < 0.9)  return "rgba(234,179,8,0.30)";
  if (r <= 1.1) return "rgba(34,197,94,0.28)";
  return "rgba(99,102,241,0.28)";
}

// ─── EmployeeGrid ──────────────────────────────────────────────────────────

function EmployeeGrid({ employees, weekDates, loading, isFullscreen }: {
  employees: EmployeeRow[];
  weekDates: Date[];
  loading: boolean;
  isFullscreen: boolean;
}) {
  const [isAtRight, setIsAtRight] = useState(false);
  const hScrollRef = useRef<HTMLDivElement>(null);

  // Re-evaluate hint when fullscreen changes (width changes)
  useEffect(() => {
    const el = hScrollRef.current;
    if (!el) return;
    setIsAtRight(el.scrollWidth - el.scrollLeft - el.clientWidth < 32);
  }, [isFullscreen]);

  const dailyCount = DAYS.map((_, di) =>
    employees.filter((e) => (e.shifts[di]?.length ?? 0) > 0).length
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative">
        {/* Right-fade scroll hint */}
        {!isAtRight && (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 flex items-center justify-end"
            style={{
              width: 56,
              background: "linear-gradient(to right, transparent, rgba(13,13,26,0.92))",
            }}
          >
            <span className="text-[10px] text-white/40 animate-bounce mr-1.5">→</span>
          </div>
        )}

        <div
          ref={hScrollRef}
          className="overflow-x-auto rounded-2xl border border-white/10"
          style={{
            background: "rgba(255,255,255,0.03)",
            touchAction: "pan-x",
            maxHeight: isFullscreen ? "calc(100dvh - 90px)" : undefined,
            overflowY: isFullscreen ? "auto" : undefined,
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIsAtRight(el.scrollWidth - el.scrollLeft - el.clientWidth < 32);
          }}
        >
          {/* Fullscreen max-width wrapper */}
          <div className={cn(isFullscreen && "max-w-6xl mx-auto")}>
            {/* Header */}
            <div className="grid sticky top-0 z-10"
              style={{ gridTemplateColumns: "11rem repeat(7, 130px)" }}>
              <div className="border-b border-r border-white/10 px-4 py-3 text-xs text-white/30 bg-[rgba(13,13,26,0.9)]">
                員工 / 星期
              </div>
              {DAYS.map((d, i) => (
                <div key={d}
                  className="border-b border-r border-white/10 py-3 text-center last:border-r-0 bg-[rgba(13,13,26,0.9)]">
                  <div className="text-sm font-medium text-white/70">{d}</div>
                  <div className="text-xs text-white/30">{fmtDate(weekDates[i])}</div>
                </div>
              ))}
            </div>

            {/* Rows */}
            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg bg-white/5" />
                ))}
              </div>
            ) : employees.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/30">
                尚無排班資料，請先執行自動排班
              </div>
            ) : (
              employees.map((emp, ei) => {
                const color = SHIFT_COLORS[ei % SHIFT_COLORS.length];
                const weekHrs = Object.values(emp.shifts)
                  .flat()
                  .reduce((s, sh) => s + sh.end - sh.start, 0);
                return (
                  <div key={emp.id}
                    className="grid border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.02] transition-colors"
                    style={{ gridTemplateColumns: "11rem repeat(7, 130px)" }}>
                    {/* Name */}
                    <div className="flex items-center gap-3 border-r border-white/10 px-4 py-3">
                      <div className="size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                        style={{ background: color.bg, border: `1px solid ${color.border}` }}>
                        {emp.name[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{emp.name}</div>
                        <div className="text-[10px] text-white/30 mt-0.5">{weekHrs}h</div>
                      </div>
                    </div>
                    {/* Day cells */}
                    {DAYS.map((_, di) => (
                      <div key={di}
                        className="border-r border-white/[0.06] last:border-r-0 p-1.5 flex flex-col gap-1">
                        {(emp.shifts[di] ?? []).map((s, si) => (
                          <Tooltip key={si}>
                            <TooltipTrigger>
                              <div
                                className="rounded-md px-2 py-1 cursor-default text-[11px] font-medium text-white/80 flex items-center gap-1"
                                style={{ background: color.bg, border: `1px solid ${color.border}` }}>
                                <span className="truncate">{fmtShift(s.start, s.end)}</span>
                                {s.isManual && (
                                  <span className="text-[9px] px-1 rounded bg-white/10 text-white/50 flex-shrink-0">手</span>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {emp.name} · {DAYS[di]}曜 {fmtShift(s.start, s.end)}
                              {s.isManual && " · 手動排班"}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })
            )}

            {/* Footer */}
            {!loading && employees.length > 0 && (
              <div className="grid border-t border-white/10"
                style={{ gridTemplateColumns: "11rem repeat(7, 130px)" }}>
                <div className="px-4 py-2 text-[11px] text-white/25">每日人力</div>
                {dailyCount.map((c, i) => (
                  <div key={i} className="py-2 text-center text-[11px] text-white/40 border-r border-white/[0.06] last:border-r-0">
                    {c} 人
                  </div>
                ))}
              </div>
            )}
          </div>{/* end fullscreen max-width wrapper */}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── CoverageHeatmap ───────────────────────────────────────────────────────

function CoverageHeatmap({ actual, weekDates, loading, isFullscreen }: {
  actual: number[][];
  weekDates: Date[];
  loading: boolean;
  isFullscreen: boolean;
}) {
  const [isAtBottom, setIsAtBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-evaluate when fullscreen changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, [isFullscreen]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10"
      style={{ background: "rgba(255,255,255,0.03)" }}>

      {/* Bottom-fade scroll hint */}
      {!isAtBottom && (
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center justify-end pb-2"
          style={{
            height: 56,
            background: "linear-gradient(to bottom, transparent, rgba(13,13,26,0.92))",
          }}
        >
          <span className="text-[10px] text-white/40 animate-bounce flex items-center gap-1">
            ↓ 滑動查看更多
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/10 flex-wrap">
        <span className="text-xs text-white/30">人力覆蓋率：</span>
        {[
          { color: "rgba(239,68,68,0.5)",  label: "不足 < 90%" },
          { color: "rgba(34,197,94,0.5)",  label: "達標 90–110%" },
          { color: "rgba(99,102,241,0.5)", label: "超配 > 110%" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="size-3 rounded-sm" style={{ background: color }} />
            <span className="text-[11px] text-white/40">{label}</span>
          </div>
        ))}
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-auto"
        style={{
          maxHeight: isFullscreen ? "calc(100dvh - 110px)" : "calc(100dvh - 350px)",
          minHeight: 200,
          touchAction: "pan-y",
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
        }}
      >
        {/* Fullscreen max-width wrapper */}
        <div className={cn("min-w-[640px]", isFullscreen && "max-w-6xl mx-auto")}>
          {/* Header */}
          <div className="grid border-b border-white/10 sticky top-0 z-10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm"
            style={{ gridTemplateColumns: "4rem repeat(7, 130px)" }}>
            <div />
            {DAYS.map((d, i) => (
              <div key={d} className="py-2 text-center border-r border-white/[0.06] last:border-r-0">
                <div className="text-xs font-medium text-white/60">{d}</div>
                <div className="text-[10px] text-white/25">{fmtDate(weekDates[i])}</div>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded bg-white/5" />
              ))}
            </div>
          ) : (
            HEAT_HOURS.map((h) => (
              <div key={h}
                className="grid border-b border-white/[0.05] last:border-b-0"
                style={{ gridTemplateColumns: "4rem repeat(7, 130px)" }}>
                <div className="flex items-center justify-end pr-2 text-[10px] text-white/35 py-1.5">
                  {pad2(h)}:00
                </div>
                {DAYS.map((_, di) => {
                  const a = actual[di][h];
                  const dem = DEMAND[di][h];
                  return (
                    <div key={di} className="border-r border-white/[0.06] last:border-r-0 p-[3px]">
                      <div
                        className="h-8 rounded flex items-center justify-center text-[11px] font-medium text-white/70"
                        style={{ background: coverageColor(a, dem) }}>
                        {dem > 0 ? `${a}/${dem}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>{/* end fullscreen max-width wrapper */}
      </div>
    </div>
  );
}

// ─── ManualEditView (drag-and-drop) ────────────────────────────────────────

type DragItemData =
  | { kind: "employee"; userId: string }
  | { kind: "assignment"; assignment: AssignmentDTO };

type DropTargetData =
  | { kind: "cell"; day: number; hour: number }
  | { kind: "trash" };

type UndoOp = { label: string; inverse: () => Promise<void> };

const EDIT_HOURS = Array.from({ length: 24 }, (_, i) => (i + 7) % 24);

function DraggableEmployeeCard({ user, color, hours }: {
  user: UserDTO;
  color: { bg: string; border: string };
  hours: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `employee-${user.id}`,
    data: { kind: "employee", userId: user.id } satisfies DragItemData,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: "none", opacity: isDragging ? 0.35 : 1 }}
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 cursor-grab active:cursor-grabbing hover:bg-white/[0.08] transition-colors select-none"
    >
      <GripVertical className="size-3.5 text-white/20 flex-shrink-0" />
      <div className="size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
        style={{ background: color.bg, border: `1px solid ${color.border}` }}>
        {user.name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white truncate">{user.name}</div>
        <div className="text-[10px] text-white/35">本週 {hours}h</div>
      </div>
    </div>
  );
}

function DraggableChip({ assignment, color, name }: {
  assignment: AssignmentDTO;
  color: { bg: string; border: string };
  name: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `assignment-${assignment.id}`,
    data: { kind: "assignment", assignment } satisfies DragItemData,
  });
  return (
    <Tooltip>
      <TooltipTrigger>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          style={{ background: color.bg, border: `1px solid ${color.border}`, touchAction: "none", opacity: isDragging ? 0.3 : 1 }}
          className="size-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white cursor-grab active:cursor-grabbing select-none"
        >
          {name[0]}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {name}{assignment.is_manual && " · 手動排班"}
      </TooltipContent>
    </Tooltip>
  );
}

function DroppableCell({ day, hour, children }: {
  day: number;
  hour: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${day}-${hour}`,
    data: { kind: "cell", day, hour } satisfies DropTargetData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-r border-b border-white/[0.05] last:border-r-0 min-h-9 p-1 flex flex-wrap content-start gap-1 transition-colors",
        isOver && "bg-purple-500/15 ring-1 ring-inset ring-purple-400/50",
      )}
    >
      {children}
    </div>
  );
}

function DroppableTrash() {
  const { setNodeRef, isOver } = useDroppable({
    id: "trash",
    data: { kind: "trash" } satisfies DropTargetData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-xs transition-colors",
        isOver ? "border-red-400/60 bg-red-500/10 text-red-300" : "border-white/15 text-white/30",
      )}
    >
      <Trash2 className="size-3.5" /> 拖曳到此處移除排班
    </div>
  );
}

function ManualEditView({
  scheduleId, assignments, orgUsers, weekDates, weekStartStr, token, queryClient, isFullscreen, disabled,
}: {
  scheduleId: string | null;
  assignments: AssignmentDTO[];
  orgUsers: UserDTO[];
  weekDates: Date[];
  weekStartStr: string;
  token: string;
  queryClient: QueryClient;
  isFullscreen: boolean;
  disabled: boolean;
}) {
  const [activeDrag, setActiveDrag] = useState<DragItemData | null>(null);
  const [undoStack, setUndoStack] = useState<UndoOp[]>([]);
  const [pending, setPending] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  const colorOf = useCallback(
    (userId: string) => {
      const idx = orgUsers.findIndex((u) => u.id === userId);
      return SHIFT_COLORS[(idx < 0 ? 0 : idx) % SHIFT_COLORS.length];
    },
    [orgUsers],
  );
  const nameOf = useCallback(
    (userId: string) => orgUsers.find((u) => u.id === userId)?.name ?? "未知員工",
    [orgUsers],
  );

  const cellsByPos = useMemo(() => {
    const m = new Map<string, AssignmentDTO[]>();
    for (const a of assignments) {
      const key = `${a.day}-${a.hour}`;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [assignments]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scheduleDetail", scheduleId] });
  }, [queryClient, scheduleId]);

  const pushUndo = useCallback((label: string, inverse: () => Promise<void>) => {
    setUndoStack((s) => [...s.slice(-9), { label, inverse }]);
  }, []);

  const handleUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || pending) return;
    setUndoStack((s) => s.slice(0, -1));
    setPending(true);
    try {
      await last.inverse();
      invalidate();
      toast.success(`已復原：${last.label}`);
    } catch (e) {
      toast.error(`復原失敗：${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  }, [undoStack, pending, invalidate]);

  // Best-effort availability check — silently skipped if the manager lacks
  // `employee.availability.edit` (still allows the drop, just no warning).
  const checkUnavailable = useCallback(async (userId: string, day: number, hour: number) => {
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ["userAvailabilityForSchedule", userId, weekStartStr],
        queryFn: () => fetchUserAvailability(userId, weekStartStr, token),
        staleTime: 5 * 60_000,
      });
      const slots = data?.[0]?.slots;
      return !!slots && slots[day]?.[hour] === false;
    } catch {
      return false;
    }
  }, [queryClient, weekStartStr, token]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag((event.active.data.current as DragItemData) ?? null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over || !scheduleId) return;
    const activeData = active.data.current as DragItemData | undefined;
    const overData = over.data.current as DropTargetData | undefined;
    if (!activeData || !overData) return;

    // ── Drop on trash → remove assignment ──────────────────────────────────
    if (overData.kind === "trash") {
      if (activeData.kind !== "assignment") return;
      const a = activeData.assignment;
      setPending(true);
      try {
        await deleteAssignment(scheduleId, a.id, token);
        pushUndo(`移除 ${nameOf(a.user_id)} · ${DAYS[a.day]} ${pad2(a.hour)}:00`, async () => {
          await createAssignment(scheduleId, a.user_id, a.day, a.hour, token);
        });
        invalidate();
        toast.success("已移除排班");
      } catch (e) {
        toast.error(`移除失敗：${(e as Error).message}`);
      } finally {
        setPending(false);
      }
      return;
    }

    const { day, hour } = overData;

    // ── Drop on a cell ───────────────────────────────────────────────────────
    if (activeData.kind === "employee") {
      const userId = activeData.userId;
      if (assignments.some((x) => x.user_id === userId && x.day === day && x.hour === hour)) {
        toast.error("此員工已排班於該時段");
        return;
      }
      setPending(true);
      try {
        const unavailable = await checkUnavailable(userId, day, hour);
        const created = await createAssignment(scheduleId, userId, day, hour, token);
        pushUndo(`新增 ${nameOf(userId)} · ${DAYS[day]} ${pad2(hour)}:00`, async () => {
          await deleteAssignment(scheduleId, created.id, token);
        });
        invalidate();
        if (unavailable) {
          toast.warning(`已新增排班，但 ${nameOf(userId)} 該時段標記為不可用（已強制排班）`);
        } else {
          toast.success("已新增排班");
        }
      } catch (e) {
        toast.error(`新增失敗：${(e as Error).message}`);
      } finally {
        setPending(false);
      }
      return;
    }

    if (activeData.kind === "assignment") {
      const a = activeData.assignment;
      if (a.day === day && a.hour === hour) return;
      if (assignments.some((x) => x.user_id === a.user_id && x.day === day && x.hour === hour)) {
        toast.error("此員工已排班於該時段");
        return;
      }
      setPending(true);
      try {
        const unavailable = await checkUnavailable(a.user_id, day, hour);
        const created = await createAssignment(scheduleId, a.user_id, day, hour, token);
        await deleteAssignment(scheduleId, a.id, token);
        pushUndo(`移動 ${nameOf(a.user_id)} · ${DAYS[a.day]} ${pad2(a.hour)}:00 → ${DAYS[day]} ${pad2(hour)}:00`, async () => {
          await createAssignment(scheduleId, a.user_id, a.day, a.hour, token);
          await deleteAssignment(scheduleId, created.id, token);
        });
        invalidate();
        if (unavailable) {
          toast.warning(`已移動排班，但 ${nameOf(a.user_id)} 該時段標記為不可用（已強制排班）`);
        } else {
          toast.success("已移動排班");
        }
      } catch (e) {
        toast.error(`移動失敗：${(e as Error).message}`);
      } finally {
        setPending(false);
      }
    }
  }, [scheduleId, assignments, token, checkUnavailable, pushUndo, nameOf, invalidate]);

  if (disabled) {
    return (
      <div className="rounded-2xl border border-white/10 py-16 text-center text-sm text-white/30"
        style={{ background: "rgba(255,255,255,0.03)" }}>
        本週尚無班表草稿，請先點擊「自動排班」建立後再進行手動調整
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={cn("flex gap-4", isFullscreen ? "flex-1 min-h-0" : "flex-col lg:flex-row")}>
        {/* Sidebar — draggable employee list */}
        <div className={cn(
          "flex flex-col gap-2 rounded-2xl border border-white/10 p-3",
          isFullscreen ? "w-64 flex-shrink-0 overflow-y-auto" : "lg:w-64 lg:flex-shrink-0",
        )} style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-white/40">員工清單 · 拖曳至右側時格</p>
            <Button
              variant="outline" size="sm"
              className="h-7 gap-1.5 border-white/10 text-white/50 hover:bg-white/5 hover:text-white text-[11px] px-2"
              onClick={handleUndo}
              disabled={undoStack.length === 0 || pending}
            >
              <Undo2 className="size-3" /> 復原 ({undoStack.length})
            </Button>
          </div>
          <div className={cn("flex flex-col gap-1.5", isFullscreen ? "" : "max-h-80 lg:max-h-none overflow-y-auto")}>
            {orgUsers.map((u) => {
              const hours = assignments.filter((a) => a.user_id === u.id).length;
              return <DraggableEmployeeCard key={u.id} user={u} color={colorOf(u.id)} hours={hours} />;
            })}
            {orgUsers.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-white/25">尚無員工資料</p>
            )}
          </div>
          <DroppableTrash />
          <p className="px-1 text-[10px] leading-relaxed text-white/25">
            拖曳員工卡片到時格可新增排班；拖曳已排班的圓形頭像可移動或移除（拉到垃圾桶區）。系統會自動驗證可用性，若違反仍可強制排班。
          </p>
        </div>

        {/* Grid */}
        <div className={cn(
          "flex-1 min-w-0 overflow-x-auto overflow-y-auto rounded-2xl border border-white/10",
          isFullscreen && "min-h-0",
        )} style={{
          background: "rgba(255,255,255,0.03)",
          maxHeight: isFullscreen ? undefined : "calc(100dvh - 350px)",
          touchAction: "pan-x pan-y",
        }}>
          <div className="min-w-[640px]">
            <div className="grid border-b border-white/10 sticky top-0 z-10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm"
              style={{ gridTemplateColumns: "4rem repeat(7, 130px)" }}>
              <div />
              {DAYS.map((d, i) => (
                <div key={d} className="py-2 text-center border-r border-white/[0.06] last:border-r-0">
                  <div className="text-xs font-medium text-white/60">{d}</div>
                  <div className="text-[10px] text-white/25">{fmtDate(weekDates[i])}</div>
                </div>
              ))}
            </div>
            {EDIT_HOURS.map((h) => (
              <div key={h} className="grid border-b border-white/[0.05] last:border-b-0"
                style={{ gridTemplateColumns: "4rem repeat(7, 130px)" }}>
                <div className="flex items-center justify-end pr-2 text-[10px] text-white/35 py-1">
                  {pad2(h)}:00
                </div>
                {DAYS.map((_, di) => {
                  const here = cellsByPos.get(`${di}-${h}`) ?? [];
                  return (
                    <DroppableCell key={di} day={di} hour={h}>
                      {here.map((a) => (
                        <DraggableChip key={a.id} assignment={a} color={colorOf(a.user_id)} name={nameOf(a.user_id)} />
                      ))}
                    </DroppableCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeDrag?.kind === "employee" && (() => {
          const u = orgUsers.find((x) => x.id === activeDrag.userId);
          if (!u) return null;
          const c = colorOf(u.id);
          return (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2 shadow-xl"
              style={{ background: "rgba(20,20,36,0.95)", borderColor: c.border }}>
              <div className="size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}>{u.name[0]}</div>
              <span className="text-sm text-white">{u.name}</span>
            </div>
          );
        })()}
        {activeDrag?.kind === "assignment" && (() => {
          const c = colorOf(activeDrag.assignment.user_id);
          return (
            <div className="size-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shadow-xl"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}>
              {nameOf(activeDrag.assignment.user_id)[0]}
            </div>
          );
        })()}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
  const { data: session } = useSession();
  const token       = session?.user?.access_token ?? "";
  const orgId       = session?.user?.organization_id ?? "";
  const calToken    = session?.user?.calendar_token;

  // Fullscreen — declare before any useEffect that references it
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const weekStartStr = toLocalDateStr(weekStart);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }),
    [weekStart],
  );
  const weekLabel = `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`;

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  // Auto-select first store
  useEffect(() => {
    if (!selectedStoreId && stores.length > 0) setSelectedStoreId(stores[0].id);
  }, [stores, selectedStoreId]);

  const storeId = selectedStoreId || stores[0]?.id || "";

  const { data: orgUsers = [] } = useQuery({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: scheduleList = [] } = useQuery({
    queryKey: ["scheduleList", storeId],
    queryFn: () => fetchScheduleList(storeId, token),
    enabled: !!storeId && !!token,
  });

  const currentScheduleSummary = scheduleList.find((s) => s.week_start === weekStartStr);

  const { data: scheduleDetail, isLoading: scheduleLoading } = useQuery({
    queryKey: ["scheduleDetail", currentScheduleSummary?.id],
    queryFn: () => fetchScheduleDetail(currentScheduleSummary!.id, token),
    enabled: !!currentScheduleSummary?.id && !!token,
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  const status = currentScheduleSummary?.status ?? null;
  const employees = useMemo(
    () => (scheduleDetail ? buildEmployeeRows(scheduleDetail.assignments, orgUsers) : []),
    [scheduleDetail, orgUsers],
  );
  const actual = useMemo(
    () => (scheduleDetail ? buildActual(scheduleDetail.assignments) : Array.from({ length: 7 }, () => Array(24).fill(0))),
    [scheduleDetail],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: () => generateSchedule(storeId, weekStartStr, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduleList", storeId] });
      queryClient.invalidateQueries({ queryKey: ["scheduleDetail"] });
      toast.success("自動排班完成");
    },
    onError: (e: Error) => toast.error(`排班失敗：${e.message}`),
  });

  const statusMutation = useMutation({
    mutationFn: (nextStatus: "published" | "archived") =>
      updateScheduleStatus(currentScheduleSummary!.id, nextStatus, token),
    onSuccess: (_, nextStatus) => {
      queryClient.invalidateQueries({ queryKey: ["scheduleList", storeId] });
      const msg = nextStatus === "published" ? "班表已發布" : "班表已封存，薪資報告生成中";
      toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Calendar ──────────────────────────────────────────────────────────────

  const calendarUrl = calToken
    ? `webcal://localhost:8000/api/calendar/${calToken}/personal.ics`
    : null;

  const copyUrl = () => {
    if (!calendarUrl) return;
    navigator.clipboard.writeText(calendarUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shiftWeek = (delta: number) => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta * 7);
      return d;
    });
  };

  const isMutating = generateMutation.isPending || statusMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">班表管理</h1>
          <p className="mt-1 text-sm text-white/40">檢視、調整並發布週班表</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Store selector */}
          <Select value={storeId} onValueChange={setSelectedStoreId}>
            <SelectTrigger className="h-9 w-[130px] border-white/10 bg-white/5 text-sm text-white">
              <span>{stores.find(s => s.id === storeId)?.name ?? "選擇門市"}</span>
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Week nav */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 h-9">
            <button onClick={() => shiftWeek(-1)}
              className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 text-sm text-white/70 min-w-[100px] text-center">{weekLabel}</span>
            <button onClick={() => shiftWeek(1)}
              className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors">
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Status badge */}
          {status ? (
            <Badge className={cn("border text-xs", STATUS_CONFIG[status].cls)}>
              {STATUS_CONFIG[status].label}
            </Badge>
          ) : (
            <Badge className="border border-white/10 bg-white/5 text-white/30 text-xs">
              未建立
            </Badge>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="gap-2 border-0 text-white hover:opacity-90"
          style={{
            background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
            boxShadow: "0 2px 16px rgba(124,58,237,0.3)",
          }}
          onClick={() => generateMutation.mutate()}
          disabled={isMutating || status === "published" || status === "archived"}
        >
          {generateMutation.isPending
            ? <Loader2 className="size-4 animate-spin" />
            : <Zap className="size-4" />}
          自動排班
        </Button>

        <Button
          variant="outline"
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
          onClick={() => statusMutation.mutate("published")}
          disabled={isMutating || status !== "draft"}
        >
          {statusMutation.isPending && statusMutation.variables === "published"
            ? <Loader2 className="size-4 animate-spin" />
            : <Send className="size-4" />}
          發布班表
        </Button>

        <Button
          variant="outline"
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
          onClick={() => statusMutation.mutate("archived")}
          disabled={isMutating || status !== "published"}
        >
          {statusMutation.isPending && statusMutation.variables === "archived"
            ? <Loader2 className="size-4 animate-spin" />
            : <Archive className="size-4" />}
          封存
        </Button>

        {/* Calendar subscription */}
        <Popover>
          <PopoverTrigger className="ml-auto inline-flex items-center gap-2 rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors">
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

      {/* Views — fullscreen container wraps everything below */}
      <div
        ref={containerRef}
        className={cn(isFullscreen && "flex flex-col")}
        style={isFullscreen ? { height: "100dvh", background: "#0D0D1A", padding: "16px", gap: "12px" } : undefined}
      >
        <Tabs defaultValue="employee" className={cn(isFullscreen && "flex flex-col flex-1 min-h-0")}>
          {/* TabsList + fullscreen button */}
          <div className="flex items-center gap-2">
            <TabsList className="h-auto gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              <TabsTrigger
                value="employee"
                className="rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none">
                員工視角
              </TabsTrigger>
              <TabsTrigger
                value="coverage"
                className="rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none">
                覆蓋率
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className="rounded-lg px-5 py-2 text-sm text-white/50 data-[state=active]:bg-purple-600/30 data-[state=active]:text-white data-[state=active]:shadow-none">
                手動編輯
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
          </div>

          <TabsContent
            value="employee"
            className={cn("mt-5", isFullscreen && "mt-3 flex-1 min-h-0")}
          >
            <EmployeeGrid
              employees={employees}
              weekDates={weekDates}
              loading={scheduleLoading}
              isFullscreen={isFullscreen}
            />
          </TabsContent>
          <TabsContent
            value="coverage"
            className={cn("mt-5", isFullscreen && "mt-3 flex-1 min-h-0")}
          >
            <CoverageHeatmap
              actual={actual}
              weekDates={weekDates}
              loading={scheduleLoading}
              isFullscreen={isFullscreen}
            />
          </TabsContent>
          <TabsContent
            value="manual"
            className={cn("mt-5", isFullscreen && "mt-3 flex-1 min-h-0 flex flex-col")}
          >
            <ManualEditView
              scheduleId={currentScheduleSummary?.id ?? null}
              assignments={scheduleDetail?.assignments ?? []}
              orgUsers={orgUsers}
              weekDates={weekDates}
              weekStartStr={weekStartStr}
              token={token}
              queryClient={queryClient}
              isFullscreen={isFullscreen}
              disabled={!currentScheduleSummary || status === "archived"}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
