"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CalendarDays, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const loginSchema = z.object({
  email: z.string().email("請輸入有效的電子郵件"),
  password: z.string().min(1, "請輸入密碼"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginForm) {
    setIsPending(true);
    try {
      const result = await signIn("credentials", {
        ...values,
        redirect: false,
      });
      if (result?.error) {
        toast.error("帳號或密碼錯誤，請重試");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main
      className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4"
      style={{
        background:
          "linear-gradient(135deg, #0D0D1A 0%, #111128 50%, #0D0D1A 100%)",
      }}
    >
      {/* Background glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full"
        style={{
          background: "radial-gradient(circle, #7C3AED 0%, transparent 65%)",
          filter: "blur(90px)",
          opacity: 0.25,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-20 h-[400px] w-[400px] rounded-full"
        style={{
          background: "radial-gradient(circle, #6D28D9 0%, transparent 65%)",
          filter: "blur(80px)",
          opacity: 0.2,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-1/4 h-64 w-64 rounded-full"
        style={{
          background: "radial-gradient(circle, #818CF8 0%, transparent 65%)",
          filter: "blur(60px)",
          opacity: 0.1,
        }}
      />

      {/* Card with gradient border */}
      <div
        className="relative w-full max-w-sm rounded-2xl p-px"
        style={{
          background:
            "linear-gradient(135deg, rgba(124,58,237,0.5) 0%, rgba(255,255,255,0.06) 50%, rgba(109,40,217,0.3) 100%)",
        }}
      >
        <div
          className="rounded-2xl px-8 py-9"
          style={{
            background: "rgba(10, 10, 22, 0.88)",
            backdropFilter: "blur(24px)",
          }}
        >
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, rgba(124,58,237,0.35) 0%, rgba(139,92,246,0.2) 100%)",
                border: "1px solid rgba(124,58,237,0.45)",
                boxShadow: "0 0 24px rgba(124,58,237,0.2)",
              }}
            >
              <CalendarDays className="size-7" style={{ color: "#A78BFA" }} />
            </div>
            <div className="text-center">
              <h1
                className="text-xl font-semibold tracking-tight"
                style={{ color: "#F8FAFC" }}
              >
                排班系統
              </h1>
              <p
                className="mt-1 text-sm"
                style={{ color: "rgba(248,250,252,0.45)" }}
              >
                登入您的帳號以繼續
              </p>
            </div>
          </div>

          {/* Form */}
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel
                      className="text-sm font-medium"
                      style={{ color: "rgba(248,250,252,0.65)" }}
                    >
                      電子郵件
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="h-11 placeholder:text-white/25 focus-visible:ring-purple-500/30"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          color: "#F8FAFC",
                        }}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-sm text-red-400" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel
                      className="text-sm font-medium"
                      style={{ color: "rgba(248,250,252,0.65)" }}
                    >
                      密碼
                    </FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className="h-11 pr-10 placeholder:text-white/25 focus-visible:ring-purple-500/30"
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.09)",
                            color: "#F8FAFC",
                          }}
                          {...field}
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer transition-colors hover:opacity-100"
                        style={{ color: "rgba(248,250,252,0.35)" }}
                        aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <FormMessage className="text-sm text-red-400" />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isPending}
                className="mt-2 h-11 w-full cursor-pointer border-0 font-medium text-white transition-opacity hover:opacity-90 active:opacity-80"
                style={{
                  background:
                    "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)",
                  boxShadow: "0 4px 24px rgba(124,58,237,0.35)",
                }}
              >
                {isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    登入中…
                  </span>
                ) : (
                  "登入"
                )}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </main>
  );
}
