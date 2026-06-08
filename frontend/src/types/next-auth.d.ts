import type { DefaultSession, DefaultJWT } from "next-auth";
import type { RoleGroupSummary } from "./index";

declare module "next-auth" {
  interface Session {
    error?: string;
    user: {
      id: string;
      organization_id: string;
      access_token: string;
      calendar_token: string;
      role_groups: RoleGroupSummary[];
    } & DefaultSession["user"];
  }

  interface User {
    organization_id: string;
    access_token: string;
    calendar_token: string;
    role_groups: RoleGroupSummary[];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    organization_id: string;
    access_token: string;
    calendar_token: string;
    role_groups: RoleGroupSummary[];
    error?: string;
  }
}
