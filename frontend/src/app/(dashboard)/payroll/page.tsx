"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Download, Loader2, RefreshCw,
  Plus, Trash2, Check, Search, Users, Building2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchStores, fetchOrgUsers, type StoreDTO, type UserDTO } from "@/lib/schedules-api";
import {
  fetchOrgPayroll, fetchStorePayroll, fetchUserPayroll, generatePayroll,
  fetchAdjustments, createAdjustment, updateAdjustment, deleteAdjustment,
  type PayrollReportDTO, type PayrollAdjustmentDTO,
} from "@/lib/payroll-api";

// ─── Types ──────────────────────────────────────────────────────────────────

type ContractType = "FT" | "PT" | "CUSTOM";

const AVATAR_COLORS = [
  "rgba(124,58,237,0.6)", "rgba(37,99,235,0.6)", "rgba(5,150,105,0.6)",
  "rgba(217,119,6,0.6)",  "rgba(236,72,153,0.6)", "rgba(8,145,178,0.6)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(val: string | number | null): string {
  if (val === null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return n.toLocaleString("zh-TW");
}

function fmtSigned(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("zh-TW")}`;
}

/** Salary attributed to a single store row for one report (display-time FT home-store rule). */
function storePay(r: PayrollReportDTO): number | null {
  if (r.contract_type === "PT") return r.gross_pay !== null ? parseFloat(r.gross_pay) : 0;
  if (r.contract_type === "FT") {
    // FT monthly salary counts only at the home store.
    return r.store_id === r.home_store_id && r.monthly_salary_snapshot !== null
      ? parseFloat(r.monthly_salary_snapshot)
      : null;
  }
  return null; // CUSTOM
}

function exportCSV(reports: PayrollReportDTO[], year: number, month: number) {
  const header =
    "員工姓名,員工ID,門市,週起日,工時,合約類型,時薪快照,月薪快照,薪資小計,幣別,備註";
  const rows = reports.map((r) =>
    [
      r.user_name, r.user_id, r.store_name, r.week_start, r.total_hours,
      r.contract_type, r.hourly_rate_snapshot ?? "", r.monthly_salary_snapshot ?? "",
      r.gross_pay ?? "", r.currency, r.note ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll_${year}-${String(month).padStart(2, "0")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Small UI ─────────────────────────────────────────────────────────────────

function ContractBadge({ type }: { type: ContractType }) {
  const styles: Record<ContractType, string> = {
    FT: "border-blue-500/30 bg-blue-600/15 text-blue-300",
    PT: "border-green-500/30 bg-green-600/15 text-green-300",
    CUSTOM: "border-white/15 bg-white/8 text-white/50",
  };
  return (
    <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[10px]", styles[type])}>
      {type}
    </span>
  );
}

function MonthNav({
  year, month, onPrev, onNext, disableNext,
}: {
  year: number; month: number; onPrev: () => void; onNext: () => void; disableNext: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={onPrev} className="size-8">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="w-24 text-center text-sm font-medium tabular-nums">
        {year} 年 {month} 月
      </span>
      <Button variant="ghost" size="icon" onClick={onNext} disabled={disableNext} className="size-8">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

// ─── 門市 (per-store, management) view ─────────────────────────────────────────

interface StoreUserRow {
  user_id: string;
  user_name: string;
  contract_type: ContractType;
  total_hours: number;
  pay: number | null;
  home_store_id: string | null;
}
interface StoreSection {
  store_id: string;
  store_name: string;
  rows: StoreUserRow[];
  subtotalHours: number;
  subtotalPay: number;
}

function groupStoreSections(reports: PayrollReportDTO[]): StoreSection[] {
  const sections = new Map<string, StoreSection>();
  for (const r of reports) {
    let section = sections.get(r.store_id);
    if (!section) {
      section = { store_id: r.store_id, store_name: r.store_name, rows: [], subtotalHours: 0, subtotalPay: 0 };
      sections.set(r.store_id, section);
    }
    let row = section.rows.find((x) => x.user_id === r.user_id);
    if (!row) {
      row = {
        user_id: r.user_id, user_name: r.user_name, contract_type: r.contract_type,
        total_hours: 0, pay: null, home_store_id: r.home_store_id,
      };
      section.rows.push(row);
    }
    row.total_hours += parseFloat(r.total_hours);
    const p = storePay(r);
    if (r.contract_type === "PT" && p !== null) {
      row.pay = (row.pay ?? 0) + p;             // PT: sum hourly pay across weeks
    } else if (r.contract_type === "FT" && p !== null) {
      row.pay = p;                              // FT: fixed monthly value, set once
    }
  }
  for (const section of sections.values()) {
    section.rows.sort((a, b) => a.user_name.localeCompare(b.user_name, "zh-TW"));
    section.subtotalHours = section.rows.reduce((s, r) => s + r.total_hours, 0);
    section.subtotalPay = section.rows.reduce((s, r) => s + (r.pay ?? 0), 0);
  }
  return Array.from(sections.values()).sort((a, b) => a.store_name.localeCompare(b.store_name, "zh-TW"));
}

function StoreReportView({
  orgId, token, year, month, onPrev, onNext, disableNext, stores,
}: {
  orgId: string; token: string; year: number; month: number;
  onPrev: () => void; onNext: () => void; disableNext: boolean; stores: StoreDTO[];
}) {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string>("all");

  const { data: reports = [], isLoading } = useQuery<PayrollReportDTO[]>({
    queryKey: ["payroll", "store", orgId, storeId, year, month],
    queryFn: () =>
      storeId === "all"
        ? fetchOrgPayroll(orgId, year, month, token)
        : fetchStorePayroll(storeId, year, month, token),
    enabled: !!orgId && !!token,
  });

  const generateMut = useMutation({
    mutationFn: () => generatePayroll(storeId, year, month, token),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.success(`已計算 ${res.generated} 個週次的薪資`);
    },
    onError: (e: Error) => toast.error(`計算失敗：${e.message}`),
  });

  const sections = useMemo(() => groupStoreSections(reports), [reports]);
  const storeNameById = useMemo(
    () => new Map(stores.map((s) => [s.id, s.name])),
    [stores],
  );
  const selectedStoreName =
    storeId === "all" ? "全部門市" : (storeNameById.get(storeId) ?? "選擇門市");

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeId} onValueChange={(v) => v !== null && setStoreId(v)}>
          <SelectTrigger className="w-40">
            <span>{selectedStoreName}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部門市</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <MonthNav year={year} month={month} onPrev={onPrev} onNext={onNext} disableNext={disableNext} />

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={reports.length === 0}
            onClick={() => exportCSV(reports, year, month)}>
            <Download className="mr-1 size-4" />匯出 CSV
          </Button>
          <Button variant="outline" size="sm"
            disabled={storeId === "all" || generateMut.isPending}
            title={storeId === "all" ? "請先選擇特定門市" : "重新計算本月所有已封存班表的薪資"}
            onClick={() => generateMut.mutate()}>
            {generateMut.isPending
              ? <Loader2 className="mr-1 size-4 animate-spin" />
              : <RefreshCw className="mr-1 size-4" />}
            重新計算
          </Button>
        </div>
      </div>

      {/* Sections */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-lg border px-4 py-12 text-center text-sm text-muted-foreground">
          所選期間無薪資記錄。
          {storeId !== "all" && (
            <span className="mt-1 block text-xs">請確認班表已封存，或點擊「重新計算」。</span>
          )}
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.store_id} className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <Building2 className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{section.store_name}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">員工</th>
                  <th className="px-4 py-2 text-center font-medium">合約</th>
                  <th className="px-4 py-2 text-right font-medium">時數</th>
                  <th className="px-4 py-2 text-right font-medium">薪資</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.user_id} className="border-b transition-colors hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{row.user_name}</td>
                    <td className="px-4 py-2 text-center"><ContractBadge type={row.contract_type} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.total_hours}h</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {row.pay !== null ? (
                        fmtMoney(row.pay)
                      ) : row.contract_type === "FT" ? (
                        <span className="text-muted-foreground" title="月薪計入所屬門市">
                          {row.home_store_id
                            ? `— (${storeNameById.get(row.home_store_id) ?? "所屬門市"})`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30">
                  <td colSpan={2} className="px-4 py-1.5 text-xs text-muted-foreground">小計</td>
                  <td className="px-4 py-1.5 text-right text-xs font-medium tabular-nums">{section.subtotalHours}h</td>
                  <td className="px-4 py-1.5 text-right text-xs font-medium tabular-nums">{fmtMoney(section.subtotalPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

// ─── 個人 (per-employee) view ──────────────────────────────────────────────────

interface PersonalStoreRow {
  store_id: string;
  store_name: string;
  contract_type: ContractType;
  total_hours: number;
  pay: number | null;
  is_home: boolean;
}

function buildPersonalRows(
  reports: PayrollReportDTO[],
  stores: StoreDTO[],
): { rows: PersonalStoreRow[]; totalHours: number; totalPay: number; ftNoHome: boolean } {
  const byStore = new Map<string, PersonalStoreRow>();
  let ftSnapshot: number | null = null;
  let homeStoreId: string | null = null;
  let isFT = false;

  for (const r of reports) {
    if (r.contract_type === "FT") {
      isFT = true;
      homeStoreId = r.home_store_id;
      if (r.monthly_salary_snapshot !== null) ftSnapshot = parseFloat(r.monthly_salary_snapshot);
    }
    let row = byStore.get(r.store_id);
    if (!row) {
      row = {
        store_id: r.store_id, store_name: r.store_name, contract_type: r.contract_type,
        total_hours: 0, pay: null, is_home: r.home_store_id === r.store_id,
      };
      byStore.set(r.store_id, row);
    }
    row.total_hours += parseFloat(r.total_hours);
    const p = storePay(r);
    if (r.contract_type === "PT" && p !== null) row.pay = (row.pay ?? 0) + p;
    if (r.contract_type === "FT" && p !== null) row.pay = p;
  }

  // FT whose home store had no shifts this month → add a synthetic home-store row
  // so the monthly salary is still attributed (and visible).
  let ftNoHome = false;
  if (isFT && ftSnapshot !== null) {
    if (homeStoreId) {
      const homeRow = byStore.get(homeStoreId);
      if (homeRow) {
        homeRow.pay = ftSnapshot;
        homeRow.is_home = true;
      } else {
        const name = stores.find((s) => s.id === homeStoreId)?.name ?? "所屬門市";
        byStore.set(homeStoreId, {
          store_id: homeStoreId, store_name: name, contract_type: "FT",
          total_hours: 0, pay: ftSnapshot, is_home: true,
        });
      }
    } else {
      ftNoHome = true; // FT with no home store set → salary not attributed
    }
  }

  const rows = Array.from(byStore.values()).sort((a, b) =>
    a.store_name.localeCompare(b.store_name, "zh-TW"),
  );
  const totalHours = rows.reduce((s, r) => s + r.total_hours, 0);
  const totalPay = rows.reduce((s, r) => s + (r.pay ?? 0), 0);
  return { rows, totalHours, totalPay, ftNoHome };
}

// ── Adjustment row (editable) ──

function AdjustmentRow({
  adj, canEdit, onSave, onDelete, saving, deleting,
}: {
  adj: PayrollAdjustmentDTO;
  canEdit: boolean;
  onSave: (id: string, body: { label: string; amount: string }) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [label, setLabel] = useState(adj.label);
  const [amount, setAmount] = useState(adj.amount);

  useEffect(() => {
    setLabel(adj.label);
    setAmount(adj.amount);
  }, [adj.id, adj.label, adj.amount]);

  const amt = parseFloat(adj.amount);
  const dirty = label !== adj.label || amount !== adj.amount;

  if (!canEdit) {
    return (
      <tr className="border-b">
        <td className="px-4 py-2">{adj.label}</td>
        <td className={cn("px-4 py-2 text-right tabular-nums", amt >= 0 ? "text-green-400" : "text-red-400")}>
          {fmtSigned(amt)}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b">
      <td className="px-4 py-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/40"
        />
      </td>
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/40"
          />
          <Button
            size="icon" variant="ghost" className="size-8"
            disabled={!dirty || saving || !label.trim() || amount === ""}
            title="儲存"
            onClick={() => onSave(adj.id, { label: label.trim(), amount })}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className={cn("size-4", dirty && "text-green-400")} />}
          </Button>
          <Button
            size="icon" variant="ghost" className="size-8 text-red-400 hover:text-red-300"
            disabled={deleting}
            title="刪除"
            onClick={() => onDelete(adj.id)}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AdjustmentsCard({
  userId, year, month, token, canEdit,
}: {
  userId: string; year: number; month: number; token: string; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const key = ["adjustments", userId, year, month];

  const { data: adjustments = [], isLoading } = useQuery<PayrollAdjustmentDTO[]>({
    queryKey: key,
    queryFn: () => fetchAdjustments(userId, year, month, token),
    enabled: !!userId && !!token,
  });

  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const createMut = useMutation({
    mutationFn: () => createAdjustment(userId, { year, month, label: newLabel.trim(), amount: newAmount }, token),
    onSuccess: () => { invalidate(); setNewLabel(""); setNewAmount(""); toast.success("已新增項目"); },
    onError: (e: Error) => toast.error(`新增失敗：${e.message}`),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { label: string; amount: string } }) =>
      updateAdjustment(id, body, token),
    onSuccess: () => { invalidate(); toast.success("已更新項目"); },
    onError: (e: Error) => toast.error(`更新失敗：${e.message}`),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdjustment(id, token),
    onSuccess: () => { invalidate(); toast.success("已刪除項目"); },
    onError: (e: Error) => toast.error(`刪除失敗：${e.message}`),
  });

  const total = adjustments.reduce((s, a) => s + parseFloat(a.amount), 0);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">其他項目</div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">項目</th>
              <th className="px-4 py-2 text-right font-medium">金額</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.length === 0 && !canEdit && (
              <tr><td colSpan={2} className="px-4 py-4 text-center text-xs text-muted-foreground">無其他項目</td></tr>
            )}
            {adjustments.map((adj) => (
              <AdjustmentRow
                key={adj.id}
                adj={adj}
                canEdit={canEdit}
                onSave={(id, body) => updateMut.mutate({ id, body })}
                onDelete={(id) => deleteMut.mutate(id)}
                saving={updateMut.isPending && updateMut.variables?.id === adj.id}
                deleting={deleteMut.isPending && deleteMut.variables === adj.id}
              />
            ))}

            {/* Add row */}
            {canEdit && (
              <tr className="border-b bg-muted/10">
                <td className="px-4 py-1.5">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="項目名稱（如 加班 / 交通）"
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/40"
                  />
                </td>
                <td className="px-4 py-1.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <input
                      type="number"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      placeholder="±金額"
                      className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/40"
                    />
                    <Button
                      size="icon" variant="ghost" className="size-8"
                      disabled={!newLabel.trim() || newAmount === "" || createMut.isPending}
                      title="新增項目"
                      onClick={() => createMut.mutate()}
                    >
                      {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4 text-green-400" />}
                    </Button>
                    <span className="size-8" />
                  </div>
                </td>
              </tr>
            )}

            <tr className="bg-muted/30">
              <td className="px-4 py-1.5 text-xs text-muted-foreground">小計</td>
              <td className={cn("px-4 py-1.5 text-right text-xs font-medium tabular-nums", total >= 0 ? "text-green-400" : "text-red-400")}>
                {fmtSigned(total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function PersonalReportContent({
  userId, token, year, month, stores, canEdit,
}: {
  userId: string; token: string; year: number; month: number; stores: StoreDTO[]; canEdit: boolean;
}) {
  const { data: reports = [], isLoading } = useQuery<PayrollReportDTO[]>({
    queryKey: ["payroll", "user", userId, year, month],
    queryFn: () => fetchUserPayroll(userId, year, month, token),
    enabled: !!userId && !!token,
  });

  const { rows, totalHours, totalPay, ftNoHome } = useMemo(
    () => buildPersonalRows(reports, stores),
    [reports, stores],
  );

  const { data: adjustments = [] } = useQuery<PayrollAdjustmentDTO[]>({
    queryKey: ["adjustments", userId, year, month],
    queryFn: () => fetchAdjustments(userId, year, month, token),
    enabled: !!userId && !!token,
  });
  const adjustmentsTotal = adjustments.reduce((s, a) => s + parseFloat(a.amount), 0);
  const grandTotal = totalPay + adjustmentsTotal;

  return (
    <div className="space-y-4">
      {/* 基本薪資 */}
      <div className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">基本薪資</div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">本月無薪資記錄</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">門市</th>
                <th className="px-4 py-2 text-right font-medium">時數</th>
                <th className="px-4 py-2 text-right font-medium">薪資</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.store_id} className="border-b transition-colors hover:bg-muted/20">
                  <td className="px-4 py-2">
                    {row.store_name}
                    {row.is_home && (
                      <span className="ml-1.5 rounded border border-blue-500/30 bg-blue-600/15 px-1 py-0.5 text-[10px] text-blue-300">所屬</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.total_hours}h</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.pay !== null
                      ? fmtMoney(row.pay)
                      : <span className="text-muted-foreground" title="月薪計入所屬門市">—</span>}
                  </td>
                </tr>
              ))}
              <tr className="bg-muted/30">
                <td className="px-4 py-1.5 text-xs text-muted-foreground">小計</td>
                <td className="px-4 py-1.5 text-right text-xs font-medium tabular-nums">{totalHours}h</td>
                <td className="px-4 py-1.5 text-right text-xs font-medium tabular-nums">{fmtMoney(totalPay)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {ftNoHome && (
          <div className="flex items-center gap-2 border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
            <AlertCircle className="size-3.5 shrink-0" />
            此員工為全職但尚未設定所屬門市，月薪暫未計入。請至「人員管理 → 個人資料」設定所屬門市。
          </div>
        )}
      </div>

      {/* 其他項目 */}
      <AdjustmentsCard userId={userId} year={year} month={month} token={token} canEdit={canEdit} />

      {/* 總計薪資 */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-sm font-medium">總計薪資</span>
        <span className="text-lg font-semibold tabular-nums">NT$ {fmtMoney(grandTotal)}</span>
      </div>
    </div>
  );
}

function PersonalReportView({
  selfId, token, year, month, onPrev, onNext, disableNext, stores, canManage, orgId,
}: {
  selfId: string; token: string; year: number; month: number;
  onPrev: () => void; onNext: () => void; disableNext: boolean;
  stores: StoreDTO[]; canManage: boolean; orgId: string;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>(selfId);
  const [search, setSearch] = useState("");

  const { data: orgUsers = [] } = useQuery<UserDTO[]>({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: canManage && !!orgId && !!token,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return orgUsers;
    const q = search.toLowerCase();
    return orgUsers.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [orgUsers, search]);

  const selectedName = orgUsers.find((u) => u.id === selectedUserId)?.name;

  // Self-only employee → no left panel
  if (!canManage) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">我的薪資</span>
          <MonthNav year={year} month={month} onPrev={onPrev} onNext={onNext} disableNext={disableNext} />
        </div>
        <PersonalReportContent userId={selfId} token={token} year={year} month={month} stores={stores} canEdit={false} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Left: employee selector */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋員工..."
            className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/40"
          />
        </div>
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
          {filtered.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 size-6 opacity-40" />
              無員工
            </div>
          ) : filtered.map((u, i) => {
            const active = u.id === selectedUserId;
            return (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  active ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/40",
                )}
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                >
                  {u.name[0]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: report */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{selectedName ?? "員工"}</span>
          <MonthNav year={year} month={month} onPrev={onPrev} onNext={onNext} disableNext={disableNext} />
        </div>
        <PersonalReportContent
          userId={selectedUserId} token={token} year={year} month={month} stores={stores} canEdit
        />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { data: session } = useSession();
  const token = session?.user?.access_token ?? "";
  const orgId = session?.user?.organization_id ?? "";
  const selfId = session?.user?.id ?? "";

  const canManage = useMemo(() => {
    const perms = new Set(session?.user?.role_groups?.flatMap((rg) => rg.permissions) ?? []);
    return perms.has("employee.payroll.view") || perms.has("system.all");
  }, [session]);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data: stores = [] } = useQuery<StoreDTO[]>({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };
  const disableNext =
    year > today.getFullYear() ||
    (year === today.getFullYear() && month >= today.getMonth() + 1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">薪資報表</h1>

      {canManage ? (
        <Tabs defaultValue="store">
          <TabsList>
            <TabsTrigger value="store"><Building2 className="mr-1.5 size-4" />門市</TabsTrigger>
            <TabsTrigger value="personal"><Users className="mr-1.5 size-4" />個人</TabsTrigger>
          </TabsList>
          <TabsContent value="store" className="mt-4">
            <StoreReportView
              orgId={orgId} token={token} year={year} month={month}
              onPrev={prevMonth} onNext={nextMonth} disableNext={disableNext} stores={stores}
            />
          </TabsContent>
          <TabsContent value="personal" className="mt-4">
            <PersonalReportView
              selfId={selfId} token={token} year={year} month={month}
              onPrev={prevMonth} onNext={nextMonth} disableNext={disableNext}
              stores={stores} canManage={canManage} orgId={orgId}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <PersonalReportView
          selfId={selfId} token={token} year={year} month={month}
          onPrev={prevMonth} onNext={nextMonth} disableNext={disableNext}
          stores={stores} canManage={false} orgId={orgId}
        />
      )}
    </div>
  );
}
