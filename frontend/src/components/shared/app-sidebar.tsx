"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  AlarmClock,
  CalendarDays,
  Clock,
  LayoutDashboard,
  LogOut,
  Settings,
  Store,
  Users,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Session } from "next-auth";

const selfNav = [
  { href: "/dashboard", label: "首頁", icon: LayoutDashboard },
  { href: "/availability", label: "可用時段", icon: Clock },
  { href: "/preferences", label: "門市偏好", icon: Store },
  { href: "/schedules", label: "我的班表", icon: CalendarDays },
];

const managerNav = [
  { href: "/schedules", label: "班表管理", icon: CalendarDays },
  { href: "/employees", label: "員工管理", icon: Users },
  { href: "/settings/demand", label: "人力需求", icon: BarChart3 },
  { href: "/settings/deadline", label: "截止日設定", icon: AlarmClock },
];

const adminNav = [
  { href: "/settings/stores", label: "門市管理", icon: Store },
  { href: "/settings/role-groups", label: "身份組", icon: ShieldCheck },
  { href: "/settings", label: "系統設定", icon: Settings },
];

type Props = {
  user: Session["user"];
};

export function AppSidebar({ user }: Props) {
  const pathname = usePathname();

  const hasPermission = (perms: string[]) =>
    user.role_groups?.some((rg) =>
      rg.permissions.some((p) => perms.includes(p))
    ) ?? false;

  const showManager = hasPermission([
    "store.schedule.edit",
    "org.schedule.arrange",
    "org.schedule.view_all",
  ]);

  const showAdmin = hasPermission(["org.manage", "system.all"]);

  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <span className="text-sm font-semibold">排班系統</span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>個人</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {selfNav.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={pathname === href}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showManager && (
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managerNav.map(({ href, label, icon: Icon }) => (
                  <SidebarMenuItem key={`mgr-${href}`}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={pathname === href}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>系統</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map(({ href, label, icon: Icon }) => (
                  <SidebarMenuItem key={`adm-${href}`}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={pathname === href}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-3 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {user.name ?? "使用者"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="登出"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
