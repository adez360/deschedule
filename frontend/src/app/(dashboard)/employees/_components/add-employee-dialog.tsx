"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createUser, type UserCreateBody } from "@/lib/users-api";

const empty = (): UserCreateBody & { confirm: string } => ({
  name: "", nickname: "", email: "", password: "", phone: "", confirm: "",
});

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

  const mut = useMutation({
    mutationFn: () => createUser(orgId, {
      name: form.name.trim(),
      nickname: form.nickname?.trim() || undefined,
      email: form.email.trim(),
      password: form.password,
      phone: form.phone?.trim() || null,
    }, token),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: ["orgUsers"] });
      toast.success(`已新增員工「${user.name}」`);
      setOpen(false);
      setForm(empty());
      onCreated?.(user.id);
    },
    onError: (e: Error) => toast.error(`新增失敗：${e.message}`),
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const pwValid = form.password.length >= 8;
  const pwMatch = form.password === form.confirm;
  const canSubmit = form.name.trim().length > 0 && emailValid && pwValid && pwMatch;

  const field = "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-colors";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty()); }}>
      <DialogTrigger
        render={<button className="h-10 flex-shrink-0 rounded-xl bg-purple-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-purple-500 flex items-center gap-1.5" />}
      >
        <UserPlus className="size-4" />新增
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#12121e] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">新增員工</DialogTitle>
          <DialogDescription className="text-white/40">建立帳號後，可在右側面板設定合約、可用時段與權限</DialogDescription>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-white/40">密碼 <span className="text-purple-400">*</span></label>
              <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="至少 8 碼" className={field} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-white/40">確認密碼 <span className="text-purple-400">*</span></label>
              <input type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} placeholder="再次輸入" className={field} />
            </div>
          </div>
          {form.password.length > 0 && !pwValid && <p className="text-[11px] text-red-400/80">密碼至少 8 碼</p>}
          {form.confirm.length > 0 && !pwMatch && <p className="text-[11px] text-red-400/80">兩次密碼不一致</p>}
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
            {mut.isPending && <Loader2 className="size-3.5 animate-spin" />}建立員工
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
