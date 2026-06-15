"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, Check, Copy, Link2, MailCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createUser, onboardUrl, type InviteResponse, type UserCreateBody } from "@/lib/users-api";

const empty = (): UserCreateBody => ({ name: "", nickname: "", email: "", phone: "" });

export function AddEmployeeDialog({
  orgId, token, onCreated,
}: {
  orgId: string;
  token: string;
  onCreated?: (userId: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty());
  // After creation we show the invite link instead of closing immediately.
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => { setForm(empty()); setInvite(null); setCopied(false); };

  const mut = useMutation({
    mutationFn: () => createUser(orgId, {
      name: form.name.trim(),
      nickname: form.nickname?.trim() || undefined,
      email: form.email.trim(),
      phone: form.phone?.trim() || null,
    }, token),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      setInvite(res);
      onCreated?.(res.user.id);
    },
    onError: (e: Error) => toast.error(`新增失敗：${e.message}`),
  });

  const link = invite ? onboardUrl(invite.invite_token) : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("已複製邀請連結");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("複製失敗，請手動選取連結");
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit = form.name.trim().length > 0 && emailValid;

  const field = "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger
        render={<button className="h-10 flex-shrink-0 rounded-xl bg-purple-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-purple-500 flex items-center gap-1.5" />}
      >
        <UserPlus className="size-4" />新增
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#12121e] text-white sm:max-w-md">
        {invite ? (
          // ── Step 2: invite link ────────────────────────────────────────────
          <>
            <DialogHeader>
              <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                <MailCheck className="size-5" />
              </div>
              <DialogTitle className="text-white">已建立「{invite.user.name}」</DialogTitle>
              <DialogDescription className="text-white/40">
                帳號尚未啟用。把下方邀請連結傳給員工，他開啟後即可自行設定密碼並啟用帳號。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-1">
              <label className="flex items-center gap-1.5 text-xs text-white/40">
                <Link2 className="size-3.5" />邀請連結（7 天內有效）
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white/70 focus:border-purple-500/50 focus:outline-none"
                />
                <button
                  onClick={copyLink}
                  className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-purple-500"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "已複製" : "複製"}
                </button>
              </div>
              <p className="text-[11px] text-white/30">提醒：連結含一次性權杖，請僅傳給本人。</p>
            </div>

            <DialogFooter>
              <button
                onClick={() => { reset(); }}
                className="h-9 rounded-xl border border-white/10 px-4 text-sm text-white/60 transition-colors hover:bg-white/5"
              >
                再新增一位
              </button>
              <button
                onClick={() => setOpen(false)}
                className="h-9 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-colors hover:bg-purple-500"
              >
                完成
              </button>
            </DialogFooter>
          </>
        ) : (
          // ── Step 1: details ────────────────────────────────────────────────
          <>
            <DialogHeader>
              <DialogTitle className="text-white">新增員工</DialogTitle>
              <DialogDescription className="text-white/40">建立後會產生邀請連結，員工自行設定密碼啟用帳號</DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-1">
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">姓名 <span className="text-purple-400">*</span></label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="王小明" className={field} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">暱稱</label>
                <input value={form.nickname ?? ""} onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} placeholder="留空則與姓名相同" className={field} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">電子郵件 <span className="text-purple-400">*</span></label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="user@example.com" className={field} />
                {form.email.length > 0 && !emailValid && <p className="text-[11px] text-red-400/80">電子郵件格式不正確</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/40">聯絡電話</label>
                <input value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="09XX-XXX-XXX" className={field} />
              </div>
            </div>

            <DialogFooter>
              <button onClick={() => setOpen(false)} className="h-9 rounded-xl border border-white/10 px-4 text-sm text-white/60 transition-colors hover:bg-white/5">
                取消
              </button>
              <button
                onClick={() => mut.mutate()}
                disabled={!canSubmit || mut.isPending}
                className="h-9 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {mut.isPending && <Loader2 className="size-3.5 animate-spin" />}建立並產生邀請
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
