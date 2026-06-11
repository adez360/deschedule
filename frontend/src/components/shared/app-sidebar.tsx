"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Clock,
  LogOut,
  Receipt,
  ShieldCheck,
  Store,
  User,
  Users,
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

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const personalNav: NavItem[] = [
  { href: "/profile", label: "個人資料", icon: User },
  { href: "/availability", label: "排班時段", icon: Clock },
  { href: "/preferences", label: "門市偏好", icon: Store },
  { href: "/schedules", label: "我的班表", icon: CalendarDays },
  { href: "/payroll", label: "薪資報表", icon: Receipt },
];

const managerNav: NavItem[] = [
  { href: "/schedules", label: "班表管理", icon: CalendarRange },
  { href: "/employees", label: "人員管理", icon: Users },
];

const adminMgmtNav: NavItem[] = [
  { href: "/settings/stores", label: "門市管理", icon: Store },
  { href: "/settings/role-groups", label: "身份組與權限", icon: ShieldCheck },
];

const systemNav: NavItem[] = [
  { href: "/settings/demand", label: "人力需求", icon: BarChart3 },
  { href: "/settings/deadline", label: "截止日設定", icon: AlarmClock },
];

function NavGroup({ items, prefix }: { items: NavItem[]; prefix: string }) {
  const pathname = usePathname();
  return (
    <SidebarMenu>
      {items.map(({ href, label, icon: Icon }) => (
        <SidebarMenuItem key={`${prefix}-${href}`}>
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
  );
}

type Props = {
  user: Session["user"];
};

export function AppSidebar({ user }: Props) {
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

  const mgmtNav: NavItem[] = [
    ...(showManager ? managerNav : []),
    ...(showAdmin ? adminMgmtNav : []),
  ];

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
            <NavGroup items={personalNav} prefix="self" />
          </SidebarGroupContent>
        </SidebarGroup>

        {mgmtNav.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavGroup items={mgmtNav} prefix="mgmt" />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>系統設定</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavGroup items={systemNav} prefix="sys" />
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
