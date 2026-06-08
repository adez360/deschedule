"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Copy, Trash2, ChevronLeft, ChevronRight, ChevronDown, Loader2, Maximize2, Minimize2, Layers, Wrench, PanelTop, PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores } from "@/lib/schedules-api";
import { fetchDemand, saveDemand, copyDemandFromWeek, emptySlots } from "@/lib/demand-api";
import { fetchSkills, fetchSkillDemand, setSkillDemand, type SkillDTO } from "@/lib/skills-api";

const SKILL_TAG_COLORS = [
  { bg: "rgba(45,212,191,0.35)",  text: "rgba(204,251,241,0.95)" },  // teal
  { bg: "rgba(251,191,36,0.35)",  text: "rgba(254,243,199,0.95)" },  // amber
  { bg: "rgba(244,114,182,0.35)", text: "rgba(252,231,243,0.95)" },  // pink
  { bg: "rgba(96,165,250,0.35)",  text: "rgba(219,234,254,0.95)" },  // blue
  { bg: "rgba(163,230,53,0.35)",  text: "rgba(236,252,203,0.95)" },  // lime
];

// ─── Constants ─────────────────────────────────────────────────────────────

const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => (i + 7) % 24);
const MAX_DEMAND = 5;
const DIVIDER_HOURS = [7, 12, 15, 18, 23];

const DEMAND_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "rgba(255,255,255,0.05)", text: "transparent" },
  1: { bg: "rgba(124,58,237,0.20)",  text: "rgba(196,181,253,0.8)" },
  2: { bg: "rgba(124,58,237,0.38)",  text: "rgba(221,214,254,0.9)" },
  3: { bg: "rgba(124,58,237,0.56)",  text: "rgba(237,233,254,1)"   },
  4: { bg: "rgba(124,58,237,0.72)",  text: "#fff" },
  5: { bg: "rgba(109,40,217,0.88)",  text: "#fff" },
};

const PRESETS = [
  { label: "早班", start: 7,  end: 15 },
  { label: "晚班", start: 15, end: 23 },
  { label: "夜班", start: 23, end: 8  }, // 23:00–08:00 跨日，dur=9
  { label: "全選", start: 0,  end: 24 }, // 所有 24 小時
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function getMondayOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}
function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getMonth() + 1}/${d.getDate()}`; }

// ─── DemandGrid ─────────────────────────────────────────────────────────────

interface OverlaySkill { id: string; name: string; slots: number[][]; colorIdx: number; }

// Bundles every "work ability" related control so the fullscreen control panel
// can host them alongside the cell-value setter (single source of truth — see page-level state).
interface SkillPanelData {
  skills: SkillDTO[];
  skillDemandMap: Map<string, number[][]>;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  editSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
  editingSkill: SkillDTO | undefined;
  editLocalSlots: number[][];
  onEditChange: (s: number[][]) => void;
  editLoading: boolean;
  editDirty: boolean;
  onSaveEdit: () => void;
  saving: boolean;
}

// Work-ability layer toggle + per-skill chips — shared between the page-level panel
// and the fullscreen control panel so both stay visually and behaviourally identical.
function SkillControls({ panel, vertical }: { panel: SkillPanelData; vertical?: boolean }) {
  return (
    <div className={cn("flex gap-1.5", vertical ? "flex-col items-stretch" : "flex-wrap items-center")}>
      <button
        onClick={panel.onToggleOverlay}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] border transition-all",
          vertical && "justify-center",
          panel.showOverlay
            ? "border-purple-500/50 bg-purple-600/25 text-white"
            : "border-white/[0.15] bg-white/[0.08] text-white/60 hover:bg-white/[0.13]",
        )}
      >
        <Layers className="size-3" />
        <span className="leading-none whitespace-nowrap">工作能力 {panel.showOverlay ? "顯示中" : "已隱藏"}</span>
      </button>
      <div className={cn("flex gap-1", vertical ? "flex-col items-stretch" : "flex-wrap items-center")}>
        {panel.skills.map((sk, i) => {
          const hasData = panel.skillDemandMap.has(sk.id);
          const c = SKILL_TAG_COLORS[i % SKILL_TAG_COLORS.length];
          const active = panel.editSkillId === sk.id;
          return (
            <button key={sk.id}
              onClick={() => panel.onSelectSkill(active ? null : sk.id)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border transition-all",
                vertical && "justify-center",
                active
                  ? "border-purple-500/50 bg-purple-600/20 text-white"
                  : "border-white/10 bg-white/5 text-white/50 hover:text-white/80",
              )}
            >
              <span className="size-1.5 rounded-full shrink-0" style={{ background: c.bg, boxShadow: hasData ? `0 0 0 1px ${c.text}` : undefined }} />
              <span className="truncate">{sk.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DemandGrid({ slots, onChange, weekDates, loading, overlaySkills, showOverlay, onToggleOverlay, skillPanel, hideFullscreenButton }: {
  slots: number[][];
  onChange: (s: number[][]) => void;
  weekDates: Date[];
  loading: boolean;
  overlaySkills?: OverlaySkill[];
  showOverlay?: boolean;
  onToggleOverlay?: () => void;
  skillPanel?: SkillPanelData;
  hideFullscreenButton?: boolean;
}) {
  // Fullscreen — declare before any useEffect that references it
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Where the cell-value-setting panel docks while in fullscreen — cycles top → left → right
  const [panelSide, setPanelSide] = useState<"top" | "left" | "right">("top");
  const cyclePanelSide = useCallback(() => {
    setPanelSide(p => p === "top" ? "left" : p === "left" ? "right" : "top");
  }, []);
  const PANEL_SIDE_META = {
    top:   { icon: PanelTop,   label: "面板：上方" },
    left:  { icon: PanelLeft,  label: "面板：左側" },
    right: { icon: PanelRight, label: "面板：右側" },
  } as const;

  // Scroll affordance
  const [isAtBottom, setIsAtBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-evaluate hint when fullscreen changes (height changes)
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

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const drag = useRef({ active: false, origin: [0, 0] as [number, number], end: [0, 0] as [number, number] });
  const [seed, setSeed] = useState(0);
  const rafRef = useRef(0);
  const [selection, setSelection] = useState<{ dMin: number; dMax: number; rMin: number; rMax: number } | null>(null);
  const tick = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setSeed((n) => n + 1));
  }, []);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const applySelection = useCallback((val: number) => {
    if (!selection) return;
    const { dMin, dMax, rMin, rMax } = selection;
    const next = slotsRef.current.map((row) => [...row]);
    for (let d = dMin; d <= dMax; d++)
      for (let r = rMin; r <= rMax; r++)
        next[d][DISPLAY_HOURS[r]] = val;
    onChange(next);
    setSelection(null);
  }, [selection, onChange]);

  useEffect(() => {
    const commit = () => {
      if (!drag.current.active) return;
      cancelAnimationFrame(rafRef.current);
      const [d0, r0] = drag.current.origin;
      const [d1, r1] = drag.current.end;
      drag.current.active = false;
      setSelection({ dMin: Math.min(d0, d1), dMax: Math.max(d0, d1), rMin: Math.min(r0, r1), rMax: Math.max(r0, r1) });
      setSeed((n) => n + 1);
    };
    window.addEventListener("pointerup", commit);
    return () => window.removeEventListener("pointerup", commit);
  }, []);

  const preview = (() => {
    if (!drag.current.active) return null;
    const [d0, r0] = drag.current.origin;
    const [d1, r1] = drag.current.end;
    return { dMin: Math.min(d0, d1), dMax: Math.max(d0, d1), rMin: Math.min(r0, r1), rMax: Math.max(r0, r1) };
  })();
  void seed;

  const selCellCount = selection ? (selection.dMax - selection.dMin + 1) * (selection.rMax - selection.rMin + 1) : 0;
  const totalDemand = useMemo(() => slots.reduce((s, day) => s + day.reduce((a, h) => a + h, 0), 0), [slots]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <span className="text-xs text-white/30">本週總需求人次：<span className="text-purple-400 font-medium">{totalDemand}</span></span>
      </div>

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
        {/* Fullscreen-only: cycle where the control panel docks (top / left / right) */}
        {isFullscreen && (() => {
          const Meta = PANEL_SIDE_META[panelSide];
          return (
            <button
              onClick={cyclePanelSide}
              className="absolute top-2 right-2 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-white/[0.15] bg-white/[0.08] text-white/65 hover:bg-white/[0.13] transition-all"
              aria-label="切換設定面板位置"
            >
              <Meta.icon className="size-3" />
              <span className="text-[9px] leading-none">{Meta.label}</span>
            </button>
          );
        })()}

        {/* Side panel — cell-value setter docked to the left/right edge while in fullscreen */}
        {isFullscreen && panelSide !== "top" && (
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 rounded-2xl border border-white/15 px-2.5 py-3",
              panelSide === "left" ? "left-3" : "right-3",
            )}
            style={{ background: "rgba(13,13,26,0.95)", backdropFilter: "blur(12px)", maxHeight: "calc(100dvh - 5rem)", overflowY: "auto" }}
          >
            <span className={cn("text-[10px] text-center leading-tight transition-colors", selection ? "text-indigo-300/80" : "text-white/25")}>
              {selection ? `已選\n${selCellCount} 格` : "選取格子\n設定人數"}
            </span>
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button key={n}
                  onClick={() => selection && applySelection(n)}
                  disabled={!selection}
                  className={cn(
                    "size-8 rounded-md text-[11px] font-bold border transition-all",
                    selection
                      ? "border-white/20 hover:border-purple-500/60 hover:scale-110 cursor-pointer"
                      : "border-white/[0.06] cursor-default opacity-30",
                  )}
                  style={{ background: DEMAND_STYLE[n].bg, color: n === 0 ? "rgba(255,255,255,0.5)" : DEMAND_STYLE[n].text }}>
                  {n}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSelection(null)}
              className={cn(
                "size-6 flex items-center justify-center rounded text-[11px] text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors",
                !selection && "invisible pointer-events-none",
              )}
            >
              ✕
            </button>

            {/* Work-ability controls — unified into the same panel so nothing lives outside it in fullscreen */}
            {skillPanel && skillPanel.skills.length > 0 && (
              <>
                <div className="w-full h-px bg-white/10" />
                <SkillControls panel={skillPanel} vertical />
              </>
            )}
          </div>
        )}

        {/* Fullscreen-only: per-skill sub-demand editor — rendered inline (not a portal) so it
            stays visible inside the fullscreen element; opened via the chips in the control panel */}
        {isFullscreen && skillPanel?.editSkillId && skillPanel.editingSkill && (
          <div
            className="absolute inset-4 sm:inset-10 z-40 rounded-2xl border border-white/15 flex flex-col overflow-hidden"
            style={{ background: "rgba(13,13,26,0.98)", backdropFilter: "blur(16px)" }}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
              <p className="text-xs text-white/50">
                編輯「<span className="text-white/80 font-medium">{skillPanel.editingSkill.name}</span>」子需求人數
              </p>
              <div className="flex items-center gap-2">
                <Button
                  className="gap-2 border-0 text-white hover:opacity-90 h-8 text-xs"
                  style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)" }}
                  onClick={skillPanel.onSaveEdit}
                  disabled={skillPanel.saving || !skillPanel.editDirty}
                >
                  {skillPanel.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  {skillPanel.editDirty ? "儲存子需求" : "已儲存"}
                </Button>
                <button
                  onClick={() => skillPanel.onSelectSkill(null)}
                  className="size-7 flex items-center justify-center rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                  aria-label="關閉編輯"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <DemandGrid
                slots={skillPanel.editLocalSlots}
                onChange={skillPanel.onEditChange}
                weekDates={weekDates}
                loading={skillPanel.editLoading}
                hideFullscreenButton
              />
            </div>
          </div>
        )}

        {/* Scroll affordance — bottom fade + hint, auto-hides when near bottom */}
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

        {/* Scroll container — handles both axes; pan-y lets finger scroll vertically
            when not on a cell; cells override with touch-action:none for drag-select */}
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-auto"
          style={{
            maxHeight: isFullscreen ? "calc(100dvh - 45px)" : "calc(100dvh - 420px)",
            minHeight: 200,
            touchAction: "pan-y",
            overscrollBehavior: "contain",
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
          {/* In fullscreen: centre content with max-width so cells don't become too wide */}
          <div className={cn(isFullscreen && "max-w-4xl mx-auto w-full")}>
            {/* Sticky day header — fullscreen button replaces the "時段" label */}
            <div className="grid sticky top-0 z-10 border-b border-white/10 bg-[rgba(13,13,26,0.95)] backdrop-blur-sm"
              style={{ gridTemplateColumns: "2.5rem repeat(7, minmax(40px, 1fr)) 0.75rem" }}>
              {hideFullscreenButton ? (
                <div className="flex items-center justify-center px-1.5 py-1.5 text-white/20">
                  <Wrench className="size-3" />
                </div>
              ) : (
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
              )}
              {DAYS.map((d, i) => (
                <div key={d} className="py-3 text-center border-r border-white/[0.06] last:border-r-0">
                  <div className="text-xs font-medium text-white/70">{d}</div>
                  <div className="text-[10px] text-white/30">{fmtDate(weekDates[i])}</div>
                </div>
              ))}
              <div />{/* right scroll zone */}
            </div>

            {/* Selection toolbar — fixed single-line height; ✕ always rendered to prevent CLS.
                Hidden when the side panel takes over (fullscreen + panelSide left/right). */}
            <div className={cn(
              "sticky top-[45px] z-10 items-center gap-x-2 px-3 py-2 border-b bg-[rgba(13,13,26,0.97)] transition-colors",
              isFullscreen && panelSide !== "top" ? "hidden" : "flex",
              selection ? "border-indigo-500/30" : "border-white/[0.06]",
            )}>
              <span className={cn("text-[11px] shrink-0 transition-colors", selection ? "text-indigo-300/80" : "text-white/20")}>
                {/* Mobile: fixed-width text so toolbar width never changes */}
                <span className="sm:hidden">
                  {selection ? `${selCellCount} 格，設定：` : "設定："}
                </span>
                {/* Desktop: full descriptive text */}
                <span className="hidden sm:inline">
                  {selection ? `已選 ${selCellCount} 格，設定人數：` : "點選或拖曳格子後設定人數："}
                </span>
              </span>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button key={n}
                    onClick={() => selection && applySelection(n)}
                    disabled={!selection}
                    className={cn(
                      "size-7 rounded-md text-[11px] font-bold border transition-all",
                      selection
                        ? "border-white/20 hover:border-purple-500/60 hover:scale-110 cursor-pointer"
                        : "border-white/[0.06] cursor-default opacity-30",
                    )}
                    style={{ background: DEMAND_STYLE[n].bg, color: n === 0 ? "rgba(255,255,255,0.5)" : DEMAND_STYLE[n].text }}>
                    {n}
                  </button>
                ))}
              </div>
              {/* Always rendered (invisible when no selection) to keep toolbar height stable */}
              <button
                onClick={() => setSelection(null)}
                className={cn(
                  "ml-1 size-6 flex items-center justify-center rounded text-[11px] text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors flex-shrink-0",
                  !selection && "invisible pointer-events-none",
                )}
              >
                ✕
              </button>

              {/* Work-ability controls — folded into the same panel while in fullscreen */}
              {isFullscreen && skillPanel && skillPanel.skills.length > 0 && (
                <>
                  <div className="w-px h-6 bg-white/10 shrink-0" />
                  <SkillControls panel={skillPanel} />
                </>
              )}
            </div>

            {/* Rows */}
            <div>
              {loading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded bg-white/5" />
                  ))}
                </div>
              ) : (
                DISPLAY_HOURS.map((hour, rowIdx) => {
                  const showLabel = DIVIDER_HOURS.includes(hour);
                  return (
                    <div key={rowIdx}
                      className={cn("grid border-b border-white/[0.04] last:border-b-0", showLabel && "border-t border-white/[0.09]")}
                      style={{ gridTemplateColumns: "2.5rem repeat(7, minmax(40px, 1fr)) 0.75rem" }}
                    >
                      <div className={cn("flex items-center justify-end pr-2 text-[10px] select-none", showLabel ? "text-white/50" : "text-transparent")}>
                        {`${pad2(hour)}:00`}
                      </div>
                      {DAYS.map((_, day) => {
                        const v = slots[day][hour];
                        const inPrev = preview && day >= preview.dMin && day <= preview.dMax && rowIdx >= preview.rMin && rowIdx <= preview.rMax;
                        const inSel  = selection && day >= selection.dMin && day <= selection.dMax && rowIdx >= selection.rMin && rowIdx <= selection.rMax;
                        const s = DEMAND_STYLE[Math.min(v, MAX_DEMAND)];
                        const bgStyle = inPrev
                          ? { background: "rgba(99,102,241,0.30)", outline: "1px solid rgba(139,92,246,0.6)" }
                          : inSel
                            ? { background: "rgba(99,102,241,0.20)", outline: "1px solid rgba(99,102,241,0.45)" }
                            : { background: s.bg };
                        return (
                          <div key={day} className="border-r border-white/[0.05] last:border-r-0 p-[2px]">
                            <div
                              data-day={day}
                              data-row={rowIdx}
                              className="relative overflow-hidden h-7 rounded cursor-pointer select-none flex items-center justify-center text-[11px] font-semibold"
                              style={{ ...bgStyle, touchAction: "none" }}
                              onPointerDown={(e) => {
                                e.preventDefault();
                                setSelection(null);
                                drag.current = { active: true, origin: [day, rowIdx], end: [day, rowIdx] };
                                tick();
                              }}
                              role="button"
                              aria-label={`${DAYS[day]}曜 ${pad2(hour)}:00 需求 ${v} 人`}
                            >
                              <span style={{ color: inPrev || inSel ? "rgba(255,255,255,0.7)" : s.text }}>{v > 0 ? v : ""}</span>
                              {showOverlay && overlaySkills && overlaySkills.length > 0 && (
                                <div className="pointer-events-none absolute bottom-0 right-0 flex flex-wrap-reverse justify-end gap-[1px] p-[1px] max-w-full">
                                  {overlaySkills
                                    .filter(sk => sk.slots[day][hour] > 0)
                                    .map(sk => {
                                      const c = SKILL_TAG_COLORS[sk.colorIdx % SKILL_TAG_COLORS.length];
                                      return (
                                        <span key={sk.id}
                                          className="text-[7px] leading-none px-[3px] py-[1px] rounded-sm font-bold whitespace-nowrap"
                                          style={{ background: c.bg, color: c.text }}
                                          title={`${sk.name}：${sk.slots[day][hour]} 人`}
                                        >
                                          {sk.name.slice(0, 1)}
                                        </span>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div />{/* right scroll zone — no touchAction:none, allows pan-y */}
                    </div>
                  );
                })
              )}
            </div>
          </div>{/* end fullscreen max-width wrapper */}
        </div>
      </div>
    </div>
  );
}

// ─── QuickPreset ────────────────────────────────────────────────────────────

function QuickPreset({ onApply }: { onApply: (days: number[], start: number, end: number, value: number) => void }) {
  const [open, setOpen] = useState(false);
  const [selectedDays, setSelectedDays] = useState(new Set([0, 1, 2, 3, 4]));
  const [value, setValue] = useState(2);
  const [startH, setStartH] = useState(9);
  const [endH, setEndH] = useState(17); // 1-24, where 24 = midnight

  const applyPreset = (p: typeof PRESETS[0]) => { setStartH(p.start); setEndH(p.end); setOpen(true); };
  const toggleDay = (d: number) => setSelectedDays((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between px-4 py-3 text-sm text-white/60">
        <button onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 hover:text-white transition-colors">
          <span className="font-medium">快速套用</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="px-2 py-0.5 rounded-md text-[11px] border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10">
          <div className="flex flex-wrap gap-2 pt-3">
            <span className="text-xs text-white/40 self-center mr-1">套用到：</span>
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => toggleDay(i)}
                className={cn("px-3 py-1 rounded-lg text-xs border transition-all",
                  selectedDays.has(i) ? "border-purple-500/50 bg-purple-600/20 text-purple-300" : "border-white/10 bg-white/5 text-white/40 hover:text-white/70")}>
                {d}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-white/40">時段：</span>
            <select value={startH} onChange={(e) => setStartH(+e.target.value)}
              className="border border-white/10 rounded-md text-xs px-2 py-1.5"
              style={{ background: "#131325", color: "#fff" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h} style={{ background: "#131325", color: "#fff" }}>{pad2(h)}:00</option>
              ))}
            </select>
            <span className="text-white/30 text-xs">—</span>
            <select value={endH} onChange={(e) => setEndH(+e.target.value)}
              className="border border-white/10 rounded-md text-xs px-2 py-1.5"
              style={{ background: "#131325", color: "#fff" }}>
              {Array.from({ length: 24 }, (_, h) => {
                const v = h + 1; // 1-24, where 24 = midnight
                return (
                  <option key={v} value={v} style={{ background: "#131325", color: "#fff" }}>
                    {v === 24 ? "24:00" : `${pad2(v)}:00`}
                  </option>
                );
              })}
            </select>

            <span className="text-xs text-white/40 ml-2">人數：</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setValue(n)}
                  className={cn("size-7 rounded-md text-xs font-semibold border transition-all",
                    value === n ? "border-purple-500/60 text-white" : "border-white/10 text-white/40 hover:text-white/70")}
                  style={{ background: value === n ? DEMAND_STYLE[n].bg : "rgba(255,255,255,0.05)" }}>
                  {n}
                </button>
              ))}
            </div>

            <Button className="gap-1.5 border-0 text-white hover:opacity-90 h-8 text-xs ml-auto"
              style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)" }}
              onClick={() => onApply([...selectedDays], startH, endH, value)}>
              套用
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function DemandPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";

  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [localSlots, setLocalSlots] = useState<number[][]>(emptySlots);
  const [isDirty, setIsDirty] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [editSkillId, setEditSkillId] = useState<string | null>(null);
  const [skillLocalSlots, setSkillLocalSlots] = useState<number[][]>(emptySlots);
  const [skillDirty, setSkillDirty] = useState(false);
  const qc = useQueryClient();

  const weekStartStr = toLocalDateStr(weekStart);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
  }), [weekStart]);
  const weekLabel = `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`;
  const prevWeekStr = toLocalDateStr(new Date(weekStart.getTime() - 7 * 86400000));
  const shiftWeek = (delta: number) => setWeekStart((p) => { const d = new Date(p); d.setDate(d.getDate() + delta * 7); return d; });

  const { data: stores = [] } = useQuery({
    queryKey: ["stores", orgId], queryFn: () => fetchStores(orgId, token), enabled: !!orgId && !!token,
  });
  useEffect(() => { if (!selectedStoreId && stores.length > 0) setSelectedStoreId(stores[0].id); }, [stores, selectedStoreId]);
  const storeId = selectedStoreId || stores[0]?.id || "";

  const { data: demand, isLoading } = useQuery({
    queryKey: ["demand", storeId, weekStartStr],
    queryFn: () => fetchDemand(storeId, weekStartStr, token),
    enabled: !!storeId && !!token,
    retry: (count, err: Error & { status?: number }) => err.status !== 404 && count < 2,
  });

  useEffect(() => {
    if (demand) { setLocalSlots(demand.slots.map((r) => [...r])); setIsDirty(false); }
    else if (!isLoading) { setLocalSlots(emptySlots()); setIsDirty(false); }
  }, [demand, isLoading, storeId, weekStartStr]);

  const handleChange = useCallback((next: number[][]) => { setLocalSlots(next); setIsDirty(true); }, []);

  const handlePreset = useCallback((days: number[], start: number, end: number, val: number) => {
    setLocalSlots((prev) => {
      const next = prev.map((r) => [...r]);
      // end is 1-24; duration handles both wraparound and end=24 (midnight)
      const dur = end > start ? end - start : end - start + 24;
      for (const d of days)
        for (let i = 0; i < dur; i++)
          next[d][(start + i) % 24] = val;
      return next;
    });
    setIsDirty(true);
  }, []);

  const saveMut = useMutation({
    mutationFn: () => saveDemand(storeId, weekStartStr, localSlots, token),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["demand", storeId, weekStartStr] }); setIsDirty(false); toast.success("人力需求已儲存"); },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const copyMut = useMutation({
    mutationFn: () => copyDemandFromWeek(storeId, weekStartStr, prevWeekStr, token),
    onSuccess: (data) => { setLocalSlots(data.slots.map((r) => [...r])); setIsDirty(false); qc.invalidateQueries({ queryKey: ["demand", storeId, weekStartStr] }); toast.success("已從上週複製"); },
    onError: (e: Error) => toast.error(`複製失敗：${e.message}`),
  });

  // ── Skill sub-demand overlay ─────────────────────────────────────────────

  const { data: orgSkills = [] } = useQuery({
    queryKey: ["orgSkills", orgId],
    queryFn: () => fetchSkills(orgId, token),
    enabled: !!orgId && !!token,
  });

  const { data: skillDemands = [], isLoading: skillDemandLoading } = useQuery({
    queryKey: ["skillDemand", storeId, weekStartStr],
    queryFn: () => fetchSkillDemand(storeId, weekStartStr, token),
    enabled: !!storeId && !!token,
  });

  const skillDemandMap = useMemo(() => {
    const m = new Map<string, number[][]>();
    for (const sd of skillDemands) m.set(sd.skill_id, sd.slots);
    return m;
  }, [skillDemands]);

  const overlaySkills: OverlaySkill[] = useMemo(() =>
    orgSkills.map((sk, i) => ({
      id: sk.id,
      name: sk.name,
      slots: skillDemandMap.get(sk.id) ?? emptySlots(),
      colorIdx: i,
    })).filter(sk => skillDemandMap.has(sk.id)),
  [orgSkills, skillDemandMap]);

  // Sync the editor's local slots when the selected skill or its server data changes
  useEffect(() => {
    if (!editSkillId) return;
    const existing = skillDemandMap.get(editSkillId);
    setSkillLocalSlots(existing ? existing.map(r => [...r]) : emptySlots());
    setSkillDirty(false);
  }, [editSkillId, skillDemandMap]);

  const handleSkillChange = useCallback((next: number[][]) => { setSkillLocalSlots(next); setSkillDirty(true); }, []);

  const saveSkillDemandMut = useMutation({
    mutationFn: () => setSkillDemand(storeId, weekStartStr, { skill_id: editSkillId!, slots: skillLocalSlots }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillDemand", storeId, weekStartStr] });
      setSkillDirty(false);
      toast.success("技能子需求已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const editingSkill = orgSkills.find(s => s.id === editSkillId);

  const isMutating = saveMut.isPending || copyMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">人力需求設定</h1>
          <p className="mt-1 text-sm text-white/40">設定各時段所需的最低人力，供自動排班參考</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={storeId} onValueChange={setSelectedStoreId}>
            <SelectTrigger className="h-9 w-[120px] border-white/10 bg-white/5 text-sm text-white">
              <span>{stores.find(s => s.id === storeId)?.name ?? "選擇門市"}</span>
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 h-9">
            <button onClick={() => shiftWeek(-1)} className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"><ChevronLeft className="size-4" /></button>
            <span className="px-2 text-sm text-white/70 min-w-[100px] text-center">{weekLabel}</span>
            <button onClick={() => shiftWeek(1)} className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      </div>

      <QuickPreset onApply={handlePreset} />

      {/* Skill overlay toggle + per-skill editor */}
      {orgSkills.length > 0 && (
        <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <button
              onClick={() => setShowOverlay(v => !v)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm border transition-all",
                showOverlay
                  ? "border-purple-500/50 bg-purple-600/20 text-white"
                  : "border-white/10 bg-white/5 text-white/40 hover:bg-white/8 hover:text-white/70",
              )}
            >
              <Layers className="size-3.5" />
              工作能力
              <span className="text-[10px] opacity-60">{showOverlay ? "顯示中" : "已隱藏"}</span>
            </button>

            <div className="flex flex-wrap items-center gap-1.5">
              <Wrench className="size-3.5 text-white/30" />
              {orgSkills.map(sk => {
                const hasData = skillDemandMap.has(sk.id);
                const colorIdx = orgSkills.findIndex(s => s.id === sk.id);
                const c = SKILL_TAG_COLORS[colorIdx % SKILL_TAG_COLORS.length];
                const active = editSkillId === sk.id;
                return (
                  <button key={sk.id}
                    onClick={() => setEditSkillId(active ? null : sk.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-all",
                      active
                        ? "border-purple-500/50 bg-purple-600/20 text-white"
                        : "border-white/10 bg-white/5 text-white/50 hover:text-white/80",
                    )}
                  >
                    <span className="size-2 rounded-full" style={{ background: c.bg, boxShadow: hasData ? `0 0 0 1px ${c.text}` : undefined }} />
                    {sk.name}
                    {!hasData && <span className="text-[9px] text-white/25">未設定</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {editSkillId && editingSkill && (
            <div className="border-t border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/40">
                  編輯「<span className="text-white/70">{editingSkill.name}</span>」子需求人數 — 表示總需求中至少需要這麼多人具備此技能
                </p>
                <Button
                  className="gap-2 border-0 text-white hover:opacity-90 h-8 text-xs"
                  style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)" }}
                  onClick={() => saveSkillDemandMut.mutate()}
                  disabled={saveSkillDemandMut.isPending || !skillDirty}
                >
                  {saveSkillDemandMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  {skillDirty ? "儲存子需求" : "已儲存"}
                </Button>
              </div>
              <DemandGrid slots={skillLocalSlots} onChange={handleSkillChange} weekDates={weekDates} loading={skillDemandLoading} />
            </div>
          )}
        </div>
      )}

      <DemandGrid
        slots={localSlots}
        onChange={handleChange}
        weekDates={weekDates}
        loading={isLoading}
        overlaySkills={overlaySkills}
        showOverlay={showOverlay}
        onToggleOverlay={() => setShowOverlay(v => !v)}
        skillPanel={orgSkills.length > 0 ? {
          skills: orgSkills,
          skillDemandMap,
          showOverlay,
          onToggleOverlay: () => setShowOverlay(v => !v),
          editSkillId,
          onSelectSkill: setEditSkillId,
          editingSkill,
          editLocalSlots: skillLocalSlots,
          onEditChange: handleSkillChange,
          editLoading: skillDemandLoading,
          editDirty: skillDirty,
          onSaveEdit: () => saveSkillDemandMut.mutate(),
          saving: saveSkillDemandMut.isPending,
        } : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button className="gap-2 border-0 text-white hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
          onClick={() => saveMut.mutate()} disabled={isMutating || !isDirty}>
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isDirty ? "儲存變更" : "已儲存"}
        </Button>
        <Button variant="outline" className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white" onClick={() => copyMut.mutate()} disabled={isMutating}>
          {copyMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}從上週複製
        </Button>
        <Button variant="outline" className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white" onClick={() => { setLocalSlots(emptySlots()); setIsDirty(true); }} disabled={isMutating}>
          <Trash2 className="size-4" />清除全部
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white/30">人力：</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="size-5 rounded text-[10px] font-bold flex items-center justify-center"
              style={{ background: DEMAND_STYLE[n].bg, color: DEMAND_STYLE[n].text }}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
