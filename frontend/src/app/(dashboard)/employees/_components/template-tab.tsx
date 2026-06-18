"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Loader2, Sparkles, CalendarClock, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AvailabilityGrid } from "@/components/shared/availability-grid";
import { fetchUserTemplate, saveUserTemplate } from "@/lib/availability-api";

type Slots = boolean[][];

const emptySlots = (): Slots => Array.from({ length: 7 }, () => Array(24).fill(false));

/**
 * Manager-facing editor for an employee's standing weekly availability template
 * (IDEA-11). Mirrors the self-service `StandingTemplate` on /availability, but
 * reads/writes via the `/users/{id}/availability-template` endpoints and supports
 * a read-only mode when the manager lacks `employee.availability.edit`.
 */
export function TemplateTab({
  userId, token, editable,
}: {
  userId: string;
  token: string;
  editable: boolean;
}) {
  const qc = useQueryClient();

  const { data: template, isLoading } = useQuery({
    queryKey: ["userTemplate", userId],
    queryFn: () => fetchUserTemplate(userId, token),
    enabled: !!userId && !!token,
  });

  const [slots, setSlots] = useState<Slots>(emptySlots());
  const [dirty, setDirty] = useState(false);

  // Reset local state when switching employees (the detail panel reuses this instance)
  useEffect(() => {
    setSlots(emptySlots());
    setDirty(false);
  }, [userId]);

  useEffect(() => {
    if (template && !dirty) setSlots(template.slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const hasTemplate = !!template;

  const saveMut = useMutation({
    mutationFn: () => saveUserTemplate(userId, slots, token),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["userTemplate", userId] });
      toast.success("標準週表已儲存");
    },
    onError: (e: Error) => toast.error(`儲存失敗：${e.message}`),
  });

  const onChange = useCallback((s: Slots) => {
    setSlots(s);
    setDirty(true);
  }, []);

  const selectedCount = slots.flat().filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Explainer banner */}
      <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-sky-400" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-white/90">員工的標準週表</p>
          <p className="text-white/50">
            系統會在<span className="text-sky-300">每週五自動</span>把這張表帶入這位員工下一週的可用時段。
            已手動填寫的週次不會被覆蓋，調整標準週表只會影響之後尚未填寫的週次。
          </p>
        </div>
      </div>

      {/* Empty-state nudge */}
      {!isLoading && !hasTemplate && !dirty && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
          <Sparkles className="size-4 shrink-0" />
          {editable
            ? "這位員工還沒有設定標準週表，你可以在下方代為排定每週的固定可用時段並儲存。"
            : "這位員工還沒有設定標準週表。"}
        </div>
      )}

      {/* Count + read-only badge */}
      <div className="flex items-center justify-end gap-2">
        {isLoading && <Loader2 className="size-3.5 text-white/30 animate-spin" />}
        {!editable && (
          <Badge className="border-white/15 bg-white/8 text-white/50 text-xs gap-1">
            <Eye className="size-2.5" />唯讀
          </Badge>
        )}
        <Badge className="border-purple-500/30 bg-purple-600/20 text-purple-300">
          已選 {selectedCount} 小時
        </Badge>
      </div>

      {/* Grid */}
      <AvailabilityGrid
        slots={slots}
        onChange={onChange}
        editable={editable}
        maxHeight="calc(100dvh - 420px)"
      />

      {/* Actions */}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            className="gap-2 border-0 text-white hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", boxShadow: "0 2px 16px rgba(124,58,237,0.3)" }}
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !dirty}
          >
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {dirty ? "儲存標準週表" : "已儲存"}
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
            onClick={() => { onChange(emptySlots()); toast.info("已清除時段"); }}
          >
            <RefreshCw className="size-4" />清除
          </Button>
        </div>
      )}
    </div>
  );
}
