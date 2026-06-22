"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  Clock,
  CalendarClock,
  CalendarRange,
  CalendarDays,
  Heart,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Store as StoreIcon,
  Users,
} from "lucide-react";
import { isScheduleManager, isOrgAdmin } from "@/lib/permissions";
import { fetchAvailability, fetchMyTemplate } from "@/lib/availability-api";
import { fetchStores, fetchScheduleList, fetchOrgUsers } from "@/lib/schedules-api";

const cardCls = "rounded-2xl border border-white/10 p-5";
const cardStyle = { background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" } as const;

// ── Week helpers (Monday-indexed, local time) ────────────────────────────────
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function md(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const user = session?.user;
  const token = user?.access_token ?? "";
  const orgId = user?.organization_id ?? "";

  const manager = user ? isScheduleManager(user) : false;
  const admin = user ? isOrgAdmin(user) : false;

  const nextMon = new Date(mondayOf(new Date()).getTime() + 7 * 86400000);
  const nextMonIso = isoDate(nextMon);
  const nextSun = new Date(nextMon.getTime() + 6 * 86400000);
  const weekLabel = `${md(nextMon)}–${md(nextSun)}`;

  // ── Employee reminders ─────────────────────────────────────────────────────
  const { data: avail } = useQuery({
    queryKey: ["myAvail", nextMonIso],
    queryFn: () => fetchAvailability(nextMonIso, token),
    enabled: !!token,
  });
  const { data: tmpl, isLoading: tmplLoading } = useQuery({
    queryKey: ["myTemplate"],
    queryFn: () => fetchMyTemplate(token),
    enabled: !!token,
  });

  const nextFilled = avail?.some(
    (a) => a.week_start === nextMonIso && a.slots.flat().some(Boolean),
  );
  const reminders: { key: string; label: string; href: string; cta: string }[] = [];
  if (avail && !nextFilled)
    reminders.push({
      key: "avail",
      label: `下一週（${weekLabel}）的可用時段尚未填寫`,
      href: "/availability",
      cta: "立即填寫",
    });
  if (!tmplLoading && tmpl == null)
    reminders.push({
      key: "tmpl",
      label: "尚未設定標準週表，設定後系統每週自動帶入可用時段",
      href: "/availability?tab=preferences",
      cta: "去設定",
    });

  return (
    <div className="max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">
          歡迎回來，{user?.name ?? user?.email ?? "使用者"}
        </h1>
        <p className="text-sm text-white/50">這是你的工作概覽與待辦提醒</p>
      </header>

      {/* ── 待辦提醒 ── */}
      <section className={cardCls} style={cardStyle}>
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="size-4 text-white/40" />
          <h2 className="text-sm font-medium text-white/80">待辦提醒</h2>
        </div>
        {reminders.length > 0 ? (
          <div className="space-y-2">
            {reminders.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className="group flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 transition-colors hover:bg-amber-500/[0.12]"
              >
                <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                <span className="flex-1 text-sm text-white/80">{r.label}</span>
                <span className="flex items-center gap-1 text-xs font-medium text-amber-300">
                  {r.cta}
                  <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">
            <CheckCircle2 className="size-4 shrink-0" />
            目前沒有待辦事項，一切就緒。
          </div>
        )}
      </section>

      {/* ── 快速動作 ── */}
      <section className={cardCls} style={cardStyle}>
        <div className="mb-4 flex items-center gap-2">
          <ChevronRight className="size-4 text-white/40" />
          <h2 className="text-sm font-medium text-white/80">快速動作</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction href="/availability" icon={Clock} label="填可用時段" />
          <QuickAction href="/availability?tab=preferences" icon={Heart} label="門市偏好" />
          <QuickAction href="/schedules" icon={CalendarDays} label="我的班表" />
          <QuickAction href="/payroll" icon={Receipt} label="薪資報表" />
        </div>
      </section>

      {/* ── 管理者：排班進度 ── */}
      {manager && (
        <ManagerScheduleProgress
          token={token}
          orgId={orgId}
          nextMonIso={nextMonIso}
          weekLabel={weekLabel}
        />
      )}

      {/* ── 管理員：組織概況 ── */}
      {admin && <OrgOverview token={token} orgId={orgId} />}
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-4 text-center transition-colors hover:border-purple-500/30 hover:bg-purple-600/10"
    >
      <Icon className="size-5 text-white/50 transition-colors group-hover:text-purple-300" />
      <span className="text-xs text-white/70 group-hover:text-white">{label}</span>
    </Link>
  );
}

// ── Manager: next-week schedule status per store (light, from schedule list) ──
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  none: { label: "尚未建立", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  draft: { label: "草稿", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  published: { label: "已發佈", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  archived: { label: "已封存", cls: "border-white/15 bg-white/5 text-white/40" },
};

function ManagerScheduleProgress({ token, orgId, nextMonIso, weekLabel }: {
  token: string;
  orgId: string;
  nextMonIso: string;
  weekLabel: string;
}) {
  const { data: stores } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });
  const lists = useQueries({
    queries: (stores ?? []).map((s) => ({
      queryKey: ["schedList", s.id],
      queryFn: () => fetchScheduleList(s.id, token),
      enabled: !!token,
    })),
  });

  return (
    <section className={cardCls} style={cardStyle}>
      <div className="mb-4 flex items-center gap-2">
        <CalendarRange className="size-4 text-white/40" />
        <h2 className="text-sm font-medium text-white/80">下一週排班進度</h2>
        <span className="text-xs text-white/30">· {weekLabel}</span>
      </div>
      <div className="space-y-2">
        {(stores ?? []).map((s, i) => {
          const sc = lists[i]?.data?.find((x) => x.week_start === nextMonIso);
          const st = STATUS_STYLE[sc?.status ?? "none"];
          return (
            <Link
              key={s.id}
              href="/schedules"
              className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-2.5 transition-colors hover:bg-white/[0.05]"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: s.color ?? "#64748b" }}
              />
              <span className="flex-1 text-sm text-white/80">{s.name}</span>
              <span className={`rounded-lg border px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
            </Link>
          );
        })}
        {stores && stores.length === 0 && (
          <p className="text-sm text-white/40">尚無門市資料。</p>
        )}
      </div>
    </section>
  );
}

// ── Admin: org headcount overview (light counts) ─────────────────────────────
function OrgOverview({ token, orgId }: { token: string; orgId: string }) {
  const { data: stores } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });
  const { data: users } = useQuery({
    queryKey: ["orgUsers", orgId],
    queryFn: () => fetchOrgUsers(orgId, token),
    enabled: !!orgId && !!token,
  });

  const active = users?.filter((u) => u.is_active && !u.is_pending).length ?? 0;
  const pending = users?.filter((u) => u.is_pending).length ?? 0;
  const inactive = users?.filter((u) => !u.is_active).length ?? 0;

  return (
    <section className={cardCls} style={cardStyle}>
      <div className="mb-4 flex items-center gap-2">
        <Users className="size-4 text-white/40" />
        <h2 className="text-sm font-medium text-white/80">組織概況</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={StoreIcon} value={stores?.length ?? 0} label="門市" href="/settings/stores" />
        <Stat icon={Users} value={active} label="在職員工" href="/employees" />
        <Stat value={pending} label="待啟用" href="/employees" accent="amber" />
        <Stat value={inactive} label="已停用" href="/employees" accent="muted" />
      </div>
    </section>
  );
}

function Stat({ icon: Icon, value, label, href, accent }: {
  icon?: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  href: string;
  accent?: "amber" | "muted";
}) {
  const valueCls =
    accent === "amber" ? "text-amber-300" : accent === "muted" ? "text-white/40" : "text-white";
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.05]"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs text-white/40">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueCls}`}>{value}</div>
    </Link>
  );
}
