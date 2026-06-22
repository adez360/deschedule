"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User as UserIcon,
  ShieldCheck,
  KeyRound,
  Sparkles,
  CalendarDays,
  Clock,
  Heart,
  Receipt,
  Building2,
  Mail,
  CalendarClock,
  Copy,
  Check,
  Loader2,
  Eye,
  EyeOff,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { fetchMe, updateMe, changeMyPassword } from "@/lib/users-api";
import { fetchStores } from "@/lib/schedules-api";
import { fetchUserSkills } from "@/lib/skills-api";

const cardCls = "rounded-2xl border border-white/10 p-5";
const cardStyle = { background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" } as const;
const inputCls =
  "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors";
const roCls =
  "h-10 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 flex items-center text-sm text-white/70";

function SectionHeader({ icon: Icon, title, hint }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="size-4 text-white/40" />
      <h2 className="text-sm font-medium text-white/80">{title}</h2>
      {hint && <span className="text-xs text-white/30">· {hint}</span>}
    </div>
  );
}

export default function ProfilePage() {
  const { data: session } = useSession();
  const user = session?.user;
  const token = user?.access_token ?? "";
  const orgId = user?.organization_id ?? "";
  const myId = user?.id ?? "";

  const qc = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchMe(token),
    enabled: !!token,
  });
  const { data: stores } = useQuery({
    queryKey: ["stores", orgId],
    queryFn: () => fetchStores(orgId, token),
    enabled: !!orgId && !!token,
  });
  const { data: skills } = useQuery({
    queryKey: ["userSkills", myId],
    queryFn: () => fetchUserSkills(myId, token),
    enabled: !!myId && !!token,
  });

  // ── Editable personal fields (self-service: nickname / phone / avatar) ───────
  const [form, setForm] = useState({ nickname: "", phone: "", avatar_url: "" });
  useEffect(() => {
    if (me) {
      setForm({
        nickname: me.nickname ?? "",
        phone: me.phone ?? "",
        avatar_url: me.avatar_url ?? "",
      });
    }
  }, [me]);

  const dirty = useMemo(
    () =>
      !!me &&
      (form.nickname !== (me.nickname ?? "") ||
        form.phone !== (me.phone ?? "") ||
        form.avatar_url !== (me.avatar_url ?? "")),
    [form, me],
  );

  const saveMut = useMutation({
    mutationFn: () =>
      updateMe(
        {
          nickname: form.nickname.trim(),
          phone: form.phone.trim() || null,
          avatar_url: form.avatar_url.trim() || null,
        },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("個人資料已更新");
    },
    onError: (e: Error) => toast.error(`更新失敗：${e.message}`),
  });

  const homeStoreName = me?.home_store_id
    ? stores?.find((s) => s.id === me.home_store_id)?.name ?? "—"
    : "（未設定）";

  const initials = (me?.nickname ?? me?.name ?? user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">個人資料</h1>
        <p className="text-sm text-white/50">管理你的個人資訊、密碼與帳號設定</p>
      </header>

      {/* ── 個人資料卡（可編輯：暱稱／電話／頭像） ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={UserIcon} title="基本資料" />

        <div className="mb-5 flex items-center gap-4">
          {form.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.avatar_url}
              alt="頭像預覽"
              className="size-14 rounded-2xl object-cover border border-white/10"
            />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-purple-600/20 text-lg font-medium text-purple-200">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white/90">{me?.name ?? "—"}</p>
            <p className="truncate font-mono text-xs text-white/40">{me?.email ?? ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="姓名" hint="如需修改請洽管理者">
            <div className={roCls}>{me?.name ?? "—"}</div>
          </Field>
          <Field label="電子郵件" hint="如需修改請洽管理者">
            <div className={`${roCls} font-mono text-xs`}>
              <Mail className="mr-1.5 size-3 shrink-0 text-white/30" />
              {me?.email ?? "—"}
            </div>
          </Field>

          <Field label="暱稱" hint="對組織內所有人公開">
            <input
              value={form.nickname}
              onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
              placeholder="顯示名稱"
              className={inputCls}
            />
          </Field>
          <Field label="聯絡電話">
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="09XX-XXX-XXX"
              inputMode="tel"
              className={inputCls}
            />
          </Field>

          <Field label="頭像連結">
            <input
              value={form.avatar_url}
              onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
              placeholder="https://..."
              className={inputCls}
            />
          </Field>
          <Field label="所屬門市" hint="由管理者指派">
            <div className={roCls}>
              <Building2 className="mr-1.5 size-3 shrink-0 text-white/30" />
              {homeStoreName}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveMut.mutate()}
            disabled={!dirty || !form.nickname.trim() || saveMut.isPending}
            className="flex h-9 items-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveMut.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {dirty ? "儲存變更" : "已儲存"}
          </button>
        </div>
      </section>

      {/* ── 帳號安全：修改密碼 ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={KeyRound} title="帳號安全" hint="修改密碼" />
        <PasswordForm token={token} />
      </section>

      {/* ── 我的技能（唯讀） ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={Sparkles} title="我的技能" />
        {skills && skills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <span
                key={s.skill_id}
                className="rounded-lg border border-purple-500/30 bg-purple-600/20 px-2.5 py-1 text-xs text-purple-200"
              >
                {s.skill.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/40">尚未被指派任何技能標籤。</p>
        )}
      </section>

      {/* ── 我的身份組（唯讀，取自 session） ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={ShieldCheck} title="我的身份組" hint="決定你的權限範圍" />
        {user?.role_groups && user.role_groups.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.role_groups.map((rg) => (
              <span
                key={rg.id}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs text-white/70"
              >
                {rg.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/40">尚未加入任何身份組。</p>
        )}
      </section>

      {/* ── 行事曆訂閱 ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={CalendarClock} title="行事曆訂閱" hint="把班表同步到你的日曆 App" />
        <CalendarSubscribe calToken={user?.calendar_token} />
      </section>

      {/* ── 設定捷徑 ── */}
      <section className={cardCls} style={cardStyle}>
        <SectionHeader icon={ChevronRight} title="設定捷徑" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Shortcut href="/availability" icon={Clock} label="我的可用時段" />
          <Shortcut href="/availability?tab=preferences" icon={Heart} label="門市偏好" />
          <Shortcut href="/schedules" icon={CalendarDays} label="我的班表" />
          <Shortcut href="/payroll" icon={Receipt} label="薪資報表" />
        </div>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs text-white/40">
        {label}
        {hint && <span className="text-white/25">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Shortcut({ href, icon: Icon, label }: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-sm text-white/70 transition-colors hover:border-purple-500/30 hover:bg-purple-600/10 hover:text-white"
    >
      <Icon className="size-4 text-white/40 transition-colors group-hover:text-purple-300" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-white/20 transition-colors group-hover:text-white/50" />
    </Link>
  );
}

// ── Password change form (inline validation + show/hide toggles) ─────────────

function PasswordForm({ token }: { token: string }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = cur.length > 0 && next.length >= 8 && confirm === next;

  const mut = useMutation({
    mutationFn: () => changeMyPassword({ current_password: cur, new_password: next }, token),
    onSuccess: () => {
      toast.success("密碼已更新");
      setCur(""); setNext(""); setConfirm(""); setTouched(false);
    },
    // Backend: 400 = wrong current password, 409 = pending account
    onError: (e: Error) =>
      toast.error(
        e.message === "Current password is incorrect" ? "目前密碼不正確" : `更新失敗：${e.message}`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="目前密碼">
          <PasswordInput value={cur} onChange={setCur} show={show} placeholder="輸入目前密碼" autoComplete="current-password" />
        </Field>
        <div className="hidden sm:block" />
        <Field label="新密碼" hint="至少 8 個字元">
          <PasswordInput value={next} onChange={setNext} show={show} placeholder="設定新密碼" autoComplete="new-password" onBlur={() => setTouched(true)} />
          {tooShort && touched && <FieldError msg="新密碼至少需 8 個字元" />}
        </Field>
        <Field label="確認新密碼">
          <PasswordInput value={confirm} onChange={setConfirm} show={show} placeholder="再次輸入新密碼" autoComplete="new-password" onBlur={() => setTouched(true)} />
          {mismatch && touched && <FieldError msg="兩次輸入的新密碼不一致" />}
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/70"
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {show ? "隱藏密碼" : "顯示密碼"}
        </button>
        <button
          onClick={() => mut.mutate()}
          disabled={!valid || mut.isPending}
          className="flex h-9 items-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mut.isPending && <Loader2 className="size-3.5 animate-spin" />}
          更新密碼
        </button>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, show, placeholder, autoComplete, onBlur }: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  placeholder: string;
  autoComplete: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className={inputCls}
    />
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1 text-xs text-rose-400" role="alert">{msg}</p>;
}

function CalendarSubscribe({ calToken }: { calToken?: string }) {
  const [copied, setCopied] = useState(false);
  const url = calToken ? `webcal://localhost:8000/api/calendar/${calToken}/personal.ics` : null;

  if (!url) return <p className="text-sm text-white/40">行事曆訂閱網址尚未就緒。</p>;

  return (
    <div className="flex items-center gap-2">
      <div className={`${roCls} flex-1 truncate font-mono text-xs`}>{url}</div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        aria-label="複製訂閱網址"
        className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
        {copied ? "已複製" : "複製"}
      </button>
    </div>
  );
}
