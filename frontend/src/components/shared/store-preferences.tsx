"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Loader2, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { StoreDTO } from "@/lib/schedules-api";
import type { StorePreferenceDTO } from "@/lib/preferences-api";

const STORE_COLORS = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#EC4899", "#0891B2"];

type Store = { id: string; name: string; weight: number; enabled: boolean; color: string };

function normalise(stores: Store[]): Store[] {
  const total = stores.filter((s) => s.enabled).reduce((a, s) => a + s.weight, 0);
  if (total <= 0) return stores;
  return stores.map((s) => (s.enabled ? { ...s, weight: s.weight / total } : s));
}

/**
 * Store-preference editor: draggable weight bar + store checklist + daily
 * scheduling cap. The data layer (whose preferences, how to persist) is
 * injected so the same UI serves both the self-service `/availability` page
 * and the admin per-employee panel.
 */
export function StorePreferences({
  storeList,
  prefsQueryKey,
  fetchPreferences,
  savePreferences,
  dailyHourMax,
  saveDailyHourMax,
  onSaved,
  editable = true,
  enabled = true,
}: {
  storeList: StoreDTO[];
  prefsQueryKey: unknown[];
  fetchPreferences: () => Promise<StorePreferenceDTO[]>;
  savePreferences: (prefs: { store_id: string; weight: number }[]) => Promise<unknown>;
  dailyHourMax: number | null;
  saveDailyHourMax: (cap: number | null) => Promise<unknown>;
  onSaved?: () => void;
  editable?: boolean;
  enabled?: boolean;
}) {
  const [stores, setStores] = useState<Store[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [dailyMax, setDailyMax] = useState<string>("");
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef({ active: false, idx: -1 });

  const { data: prefData, isLoading } = useQuery({
    queryKey: prefsQueryKey,
    queryFn: fetchPreferences,
    enabled,
  });

  useEffect(() => {
    setDailyMax(dailyHourMax != null ? String(dailyHourMax) : "");
  }, [dailyHourMax]);

  useEffect(() => {
    if (!storeList.length) return;
    const prefMap = new Map((prefData ?? []).map((p) => [p.store_id, p.weight]));
    setStores(storeList.map((s, i) => {
      const w = prefMap.get(s.id) ?? 0;
      return { id: s.id, name: s.name, weight: w, enabled: w > 0, color: STORE_COLORS[i % STORE_COLORS.length] };
    }));
    setIsDirty(false);
  }, [storeList, prefData]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const en = stores.filter((s) => s.enabled);
      await savePreferences(en.map((s) => ({ store_id: s.id, weight: s.weight })));
      const cap = dailyMax === "" ? null : Math.max(1, Math.min(24, parseInt(dailyMax, 10)));
      if (cap !== (dailyHourMax ?? null)) await saveDailyHourMax(cap);
    },
    onSuccess: () => {
      onSaved?.();
      setIsDirty(false);
      toast.success("偏好已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const enabledStores = stores.filter((s) => s.enabled);

  const toggleStore = (id: string) => {
    if (!editable) return;
    setIsDirty(true);
    setStores((prev) => {
      const store = prev.find((s) => s.id === id)!;
      if (!store.enabled) {
        const others = prev.filter((s) => s.enabled);
        const newW = others.length === 0 ? 1 : 0.1;
        const scale = others.length === 0 ? 1 : 1 - newW;
        return normalise(prev.map((s) => {
          if (s.id === id) return { ...s, enabled: true, weight: newW };
          if (s.enabled) return { ...s, weight: s.weight * scale };
          return s;
        }));
      }
      const remaining = prev.filter((s) => s.enabled && s.id !== id);
      if (remaining.length === 0) return prev.map((s) => ({ ...s, enabled: false, weight: 0 }));
      const removedW = store.weight;
      const totalR = remaining.reduce((a, s) => a + s.weight, 0);
      return normalise(prev.map((s) => {
        if (s.id === id) return { ...s, enabled: false, weight: 0 };
        if (s.enabled) {
          const share = totalR > 0 ? s.weight / totalR : 1 / remaining.length;
          return { ...s, weight: s.weight + removedW * share };
        }
        return s;
      }));
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
        let cum = 0;
        const starts = en.map((s) => { const v = cum; cum += s.weight; return v; });
        const bound = Math.max(starts[idx] + 0.02, Math.min(starts[idx + 1] + en[idx + 1].weight - 0.02, pct));
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
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  if (isLoading) {
    return (
      <div className="max-w-xl rounded-2xl border border-white/10 p-5 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 w-full rounded-xl bg-white/10 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-5">
      {!editable && (
        <Badge className="border-white/15 bg-white/8 text-white/50 text-xs gap-1"><Eye className="size-2.5" />唯讀</Badge>
      )}

      {/* Weight bar */}
      {enabledStores.length > 0 ? (
        <div className="rounded-2xl border border-white/10 p-5 space-y-3" style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
          <p className="text-sm text-white/40">{editable ? "拖曳分界線調整比重" : "門市偏好比重"}</p>
          <div ref={barRef} className="relative flex h-12 select-none overflow-hidden rounded-xl">
            {enabledStores.map((store, i) => (
              <div key={store.id} className="relative flex items-center justify-center overflow-hidden transition-[width] duration-75"
                style={{ width: `${store.weight * 100}%`, background: store.color, minWidth: 4 }}>
                {store.weight > 0.07 && (
                  <span className="truncate px-2 text-xs font-semibold text-white drop-shadow">
                    {store.name} {Math.round(store.weight * 100)}%
                  </span>
                )}
                {editable && i < enabledStores.length - 1 && (
                  <div className="absolute right-0 top-0 bottom-0 z-10 flex w-5 cursor-col-resize flex-col items-center justify-end pb-1"
                    style={{ transform: "translateX(50%)", background: "rgba(0,0,0,0.3)" }}
                    onPointerDown={(e) => { e.preventDefault(); dragging.current = { active: true, idx: i }; }}>
                    <svg width="10" height="7" viewBox="0 0 10 7" className="pointer-events-none">
                      <path d="M5 0L10 7H0L5 0Z" fill="white" fillOpacity="0.85" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 p-8 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
          <p className="text-sm text-white/30">{editable ? "請至少勾選一間門市" : "尚未設定門市偏好"}</p>
        </div>
      )}

      {/* Store checklist */}
      <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
        <h3 className="mb-4 text-sm font-medium text-white/50">門市清單</h3>
        <div className="grid grid-cols-2 gap-2">
          {stores.map((store) => (
            <button key={store.id} onClick={() => toggleStore(store.id)} disabled={!editable}
              className={cn("flex items-center gap-3 rounded-xl p-3 text-left transition-all",
                editable && "cursor-pointer hover:bg-white/5", store.enabled && "bg-white/[0.04]")}>
              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all"
                style={{ background: store.enabled ? store.color : "transparent", borderColor: store.enabled ? store.color : "rgba(255,255,255,0.2)" }}>
                {store.enabled && (
                  <svg className="size-3 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className={cn("text-sm", store.enabled ? "text-white" : "text-white/40")}>{store.name}</span>
              {store.enabled && (
                <span className="ml-auto rounded-md px-1.5 py-0.5 text-xs font-medium text-white/70" style={{ background: `${store.color}30` }}>
                  {Math.round(store.weight * 100)}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Daily cap */}
      <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}>
        <h3 className="mb-1 text-sm font-medium text-white/50">每日排班上限</h3>
        <p className="mb-3 text-[11px] text-white/25">自動排班時單日最多被安排的小時數，留空使用預設（8 小時）</p>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={24} value={dailyMax} placeholder="8" disabled={!editable}
            onChange={(e) => { setDailyMax(e.target.value); setIsDirty(true); }}
            className="h-10 w-24 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors disabled:opacity-50"
            style={{ colorScheme: "dark" }}
          />
          <span className="text-sm text-white/40">小時 / 日</span>
        </div>
      </div>

      {editable && (
        <Button
          className="gap-2 border-0 text-white hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !isDirty}
        >
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isDirty ? "儲存偏好" : "已儲存"}
        </Button>
      )}
    </div>
  );
}
