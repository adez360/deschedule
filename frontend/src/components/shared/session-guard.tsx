"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { toast } from "sonner";

export function SessionGuard() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === "BackendTokenExpired") {
      toast.error("登入已過期，請重新登入");
      signOut({ callbackUrl: "/login" });
    }
  }, [session?.error]);

  return null;
}
