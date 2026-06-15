"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchOnboardInfo, submitOnboard } from "@/lib/users-api";

const fieldStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  color: "#F8FAFC",
} as const;

const labelClass = "text-sm font-medium";
const labelStyle = { color: "rgba(248,250,252,0.65)" } as const;

function OnboardForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const { data: info, isLoading, isError, error } = useQuery({
    queryKey: ["onboard", token],
    queryFn: () => fetchOnboardInfo(token),
    enabled: !!token,
    retry: false,
  });

  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Prefill the profile fields once the invite info loads.
  useEffect(() => {
    if (info) {
      setName(info.name);
      setNickname(info.nickname);
      setPhone(info.phone ?? "");
    }
  }, [info]);

  const pwValid = password.length >= 8;
  const pwMatch = password === confirm;
  const nameValid = name.trim().length > 0;
  const canSubmit = nameValid && pwValid && pwMatch;

  const mut = useMutation({
    mutationFn: () =>
      submitOnboard(token, {
        password,
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      toast.success("帳號已啟用，請使用新密碼登入");
      router.push("/login");
    },
    onError: (e: Error) => toast.error(`啟用失敗：${e.message}`),
  });

  // ── No token ───────────────────────────────────────────────────────────────
  if (!token) {
    return <StateCard icon="error" title="缺少邀請權杖" desc="此連結不完整，請向管理者重新索取邀請連結。" />;
  }
  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-white/50">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">驗證邀請連結中…</p>
      </div>
    );
  }
  // ── Invalid / expired token ──────────────────────────────────────────────────
  if (isError || !info) {
    return (
      <StateCard
        icon="error"
        title="邀請連結無效或已過期"
        desc={(error as Error)?.message ?? "請向管理者重新索取邀請連結。"}
      />
    );
  }

  // ── Onboarding form ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="mb-7 flex flex-col items-center gap-3">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.35) 0%, rgba(139,92,246,0.2) 100%)",
            border: "1px solid rgba(124,58,237,0.45)",
            boxShadow: "0 0 24px rgba(124,58,237,0.2)",
          }}
        >
          <CalendarDays className="size-7" style={{ color: "#A78BFA" }} />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "#F8FAFC" }}>
            歡迎加入 {info.organization_name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "rgba(248,250,252,0.45)" }}>
            設定密碼並確認個人資料以啟用帳號
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }}
        className="space-y-4"
        noValidate
      >
        {/* Email — read-only, confirms account identity */}
        <div className="space-y-1.5">
          <label className={labelClass} style={labelStyle}>電子郵件</label>
          <Input value={info.email} readOnly disabled className="h-11" style={{ ...fieldStyle, opacity: 0.7 }} />
        </div>

        <div className="space-y-1.5">
          <label className={labelClass} style={labelStyle}>姓名</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="王小明"
            className="h-11 placeholder:text-white/25 focus-visible:ring-purple-500/30"
            style={fieldStyle}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className={labelClass} style={labelStyle}>暱稱</label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="顯示名稱"
              className="h-11 placeholder:text-white/25 focus-visible:ring-purple-500/30"
              style={fieldStyle}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass} style={labelStyle}>電話</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XX-XXX-XXX"
              inputMode="tel"
              className="h-11 placeholder:text-white/25 focus-visible:ring-purple-500/30"
              style={fieldStyle}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass} style={labelStyle}>設定密碼</label>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="至少 8 碼"
              className="h-11 pr-10 placeholder:text-white/25 focus-visible:ring-purple-500/30"
              style={fieldStyle}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
              style={{ color: "rgba(248,250,252,0.35)" }}
              aria-label={showPw ? "隱藏密碼" : "顯示密碼"}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {password.length > 0 && !pwValid && <p className="text-xs text-red-400">密碼至少 8 碼</p>}
        </div>

        <div className="space-y-1.5">
          <label className={labelClass} style={labelStyle}>確認密碼</label>
          <Input
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="再次輸入密碼"
            className="h-11 placeholder:text-white/25 focus-visible:ring-purple-500/30"
            style={fieldStyle}
          />
          {confirm.length > 0 && !pwMatch && <p className="text-xs text-red-400">兩次密碼不一致</p>}
        </div>

        <Button
          type="submit"
          disabled={!canSubmit || mut.isPending}
          className="mt-2 h-11 w-full cursor-pointer border-0 font-medium text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)",
            boxShadow: "0 4px 24px rgba(124,58,237,0.35)",
          }}
        >
          {mut.isPending ? (
            <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />啟用中…</span>
          ) : (
            "啟用帳號"
          )}
        </Button>
      </form>
    </>
  );
}

function StateCard({ icon, title, desc }: { icon: "error" | "success"; title: string; desc: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div
        className={`flex size-14 items-center justify-center rounded-2xl ${
          icon === "error" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
        }`}
      >
        {icon === "error" ? <AlertTriangle className="size-7" /> : <CheckCircle2 className="size-7" />}
      </div>
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "#F8FAFC" }}>{title}</h1>
        <p className="mt-1.5 text-sm" style={{ color: "rgba(248,250,252,0.45)" }}>{desc}</p>
      </div>
      <Button
        onClick={() => router.push("/login")}
        className="mt-1 h-10 cursor-pointer border-0 px-6 font-medium text-white"
        style={{ background: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)" }}
      >
        前往登入
      </Button>
    </div>
  );
}

export default function OnboardPage() {
  return (
    <main
      className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4"
      style={{ background: "linear-gradient(135deg, #0D0D1A 0%, #111128 50%, #0D0D1A 100%)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, #7C3AED 0%, transparent 65%)", filter: "blur(90px)", opacity: 0.25 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-20 h-[400px] w-[400px] rounded-full"
        style={{ background: "radial-gradient(circle, #6D28D9 0%, transparent 65%)", filter: "blur(80px)", opacity: 0.2 }}
      />

      <div
        className="relative w-full max-w-sm rounded-2xl p-px"
        style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.5) 0%, rgba(255,255,255,0.06) 50%, rgba(109,40,217,0.3) 100%)" }}
      >
        <div className="rounded-2xl px-8 py-9" style={{ background: "rgba(10, 10, 22, 0.88)", backdropFilter: "blur(24px)" }}>
          <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-white/50" /></div>}>
            <OnboardForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
