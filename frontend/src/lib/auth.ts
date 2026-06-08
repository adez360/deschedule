import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import type { RoleGroupSummary } from "@/types";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "電子郵件", type: "email" },
        password: { label: "密碼", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const backendUrl =
          process.env.BACKEND_URL ?? "http://localhost:8000";

        try {
          const res = await fetch(`${backendUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
          });

          if (!res.ok) return null;

          const data = await res.json();
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            organization_id: data.user.organization_id,
            role_groups: data.user.role_groups as RoleGroupSummary[],
            access_token: data.access_token as string,
            calendar_token: data.user.calendar_token as string,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.organization_id = user.organization_id;
        token.role_groups = user.role_groups;
        token.access_token = user.access_token;
        token.calendar_token = user.calendar_token;
        token.error = undefined;
      }
      // Detect backend JWT expiry so the frontend can redirect to login
      if (token.access_token && !token.error) {
        try {
          const payload = JSON.parse(
            Buffer.from((token.access_token as string).split(".")[1], "base64").toString(),
          );
          if (payload.exp && Date.now() / 1000 > payload.exp) {
            token.error = "BackendTokenExpired";
          }
        } catch {
          // malformed token — treat as expired
          token.error = "BackendTokenExpired";
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.organization_id = token.organization_id as string;
      session.user.access_token = token.access_token as string;
      session.user.calendar_token = token.calendar_token as string;
      session.user.role_groups = token.role_groups as RoleGroupSummary[];
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
