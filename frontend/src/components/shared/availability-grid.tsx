"use client";

import { useState, useRef, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAYS, DISPLAY_HOURS } from "@/lib/constants";

type Slots = boolean[][]; // [7][24] — index 0 = Monday, hour 0 = 00:00

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Presentational 7×24 availability grid with drag-select, mobile drag support,
 * a built-in fullscreen toggle, and a scroll affordance. State (which slots are
 * on) is owned by the parent via `slots` / `onChange`.
 */
export function AvailabilityGrid({
  slots,
  onChange,
  editable = true,
  enableFullscreen = true,
  maxHeight = "calc(100dvh - 390px)",
}: {
  slots: Slots;
  onChange: (next: Slots) => void;
  editable?: boolean;
  enableFullscreen?: boolean;
  maxHeight?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  // Re-evaluate scroll affordance when fullscreen changes (height changes)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, [isFullscreen]);

  // ── Drag state (refs → no stale closures, no extra re-renders) ──────────────
  const drag = useRef({
    active: false,
    mode: "on" as "on" | "off",
    origin: [0, 0] as [number, number], // [day, rowIdx]
    end: [0, 0] as [number, number],
  });
  const [, force] = useState(0);
  const tick = () => force((n) => n + 1);

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // Commit on global pointer-up (handles releasing outside the grid)
  useEffect(() => {
    const commit = () => {
      if (!drag.current.active) return;
      const [d0, r0] = drag.current.origin;
      const [d1, r1] = drag.current.end;
      const next = slotsRef.current.map((r) => [...r]);
      for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d++)
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
          next[d][DISPLAY_HOURS[r]] = drag.current.mode === "on";
      drag.current.active = false;
      onChangeRef.current(next);
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
    const inPreview =
      preview && day >= preview.dMin && day <= preview.dMax && rowIdx >= preview.rMin && rowIdx <= preview.rMax;
    if (inPreview && preview.mode === "on")
      return { background: "rgba(99,102,241,0.45)", border: "1px solid rgba(99,102,241,0.65)" };
    if (inPreview && preview.mode === "off")
      return { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" };
    if (slots[day][hour])
      return { background: "rgba(124,58,237,0.55)", border: "1px solid rgba(139,92,246,0.5)" };
    return {
      background:
        hour >= 8 && hour <= 14 ? "rgba(255,255,255,0.07)"
          : hour >= 15 && hour <= 22 ? "rgba(255,255,255,0.045)"
            : "rgba(255,255,255,0.055)",
      border: "1px solid rgba(255,255,255,0.13)",
    };
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden border border-white/10", isFullscreen ? "rounded-none" : "rounded-2xl")}
      style={{
        background: isFullscreen ? "#0D0D1A" : "rgba(255,255,255,0.03)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Scroll affordance — bottom fade + hint, auto-hides near bottom */}
      {!isAtBottom && (
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center justify-end pb-2"
          style={{ height: 56, background: "linear-gradient(to bottom, transparent, rgba(13,13,26,0.92))" }}
        >
          <span className="text-[10px] text-white/40 animate-bounce flex items-center gap-1">↓ 滑動查看更多時段</span>
        </div>
      )}

      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{
          maxHeight: isFullscreen ? "calc(100dvh - 45px)" : maxHeight,
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
        {/* In fullscreen: constrain width so cells don't become too wide */}
        <div className={cn(isFullscreen && "max-w-4xl mx-auto w-full")}>
          {/* Sticky day header */}
          <div className="grid grid-cols-[3rem_repeat(7,1fr)_0.75rem] sticky top-0 z-10 border-b border-white/10 bg-[rgba(13,13,26,0.92)] backdrop-blur-sm">
            {enableFullscreen ? (
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
            ) : (
              <div />
            )}
            {DAYS.map((d) => (
              <div key={d} className="py-3 text-center text-sm font-medium text-white/60">{d}</div>
            ))}
            <div />
          </div>

          {DISPLAY_HOURS.map((hour, rowIdx) => (
            <div
              key={rowIdx}
              className={cn("grid grid-cols-[3rem_repeat(7,1fr)_0.75rem]", [7, 15, 23].includes(hour) && "border-t border-white/[0.08]")}
            >
              <div className={cn("flex items-center justify-end pr-2 text-[10px]", [7, 15, 23].includes(hour) ? "text-white/50" : "text-transparent")}>
                {`${pad2(hour)}:00`}
              </div>
              {DAYS.map((_, day) => (
                <div
                  key={day}
                  data-day={day}
                  data-row={rowIdx}
                  className={cn("m-[2px] h-7 select-none rounded-md transition-colors duration-75", editable ? "cursor-pointer" : "cursor-default")}
                  style={{ ...cellStyle(day, hour, rowIdx), touchAction: "none" }}
                  onPointerDown={(e) => {
                    if (!editableRef.current) return;
                    e.preventDefault();
                    drag.current = { active: true, mode: slots[day][hour] ? "off" : "on", origin: [day, rowIdx], end: [day, rowIdx] };
                    tick();
                  }}
                  role="button"
                  aria-pressed={slots[day][hour]}
                  aria-label={`${DAYS[day]}曜 ${pad2(hour)}:00`}
                />
              ))}
              <div />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
