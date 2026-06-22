"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Clock,
  Heart,
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
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { hasPermission, isScheduleManager, isOrgAdmin } from "@/lib/permissions";
import type { Session } from "next-auth";

type NavMatchCtx = { pathname: string; tab: string | null };
type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // 自訂 active 判斷（深層連結到分頁時用）；未提供則以 pathname === href 判斷
  match?: (ctx: NavMatchCtx) => boolean;
};

// 個人（所有登入者）— 依使用頻率高→低：常看的班表置頂，低頻帳號設定置底
// 「可用時段」與「門市偏好」實為 /availability 頁的兩個分頁，深層連結到對應 tab
const personalNav: NavItem[] = [
  { href: "/schedules", label: "我的班表", icon: CalendarDays },
  {
    href: "/availability",
    label: "我的可用時段",
    icon: Clock,
    match: ({ pathname, tab }) => pathname === "/availability" && tab !== "preferences",
  },
  {
    href: "/availability?tab=preferences",
    label: "門市偏好",
    icon: Heart,
    match: ({ pathname, tab }) => pathname === "/availability" && tab === "preferences",
  },
  { href: "/payroll", label: "薪資報表", icon: Receipt },
  { href: "/profile", label: "個人資料", icon: User },
];

// 排班管理 — 班表作業 + 其前置參數設定，收攏在同一組
const scheduleManagerNav: NavItem[] = [
  { href: "/schedules", label: "班表管理", icon: CalendarRange },
];
const scheduleConfigNav: NavItem[] = [
  { href: "/settings/demand", label: "人力需求", icon: BarChart3 },
  { href: "/settings/deadline", label: "截止日設定", icon: AlarmClock },
];

// 組織設定 — 人員 / 門市 / 權限治理
const orgPeopleNav: NavItem[] = [
  { href: "/employees", label: "人員管理", icon: Users },
];
const orgAdminNav: NavItem[] = [
  { href: "/settings/stores", label: "門市管理", icon: Store },
  { href: "/settings/role-groups", label: "身份組與權限", icon: ShieldCheck },
];

function NavGroup({ items, prefix }: { items: NavItem[]; prefix: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  return (
    <SidebarMenu>
      {items.map(({ href, label, icon: Icon, match }) => (
        <SidebarMenuItem key={`${prefix}-${href}`}>
          <SidebarMenuButton
            render={<Link href={href} />}
            isActive={match ? match({ pathname, tab }) : pathname === href}
            tooltip={label}
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
  const showManager = isScheduleManager(user);

  const showAdmin = isOrgAdmin(user);

  // 人員管理：排班者、組織管理員、或專責人事（org.employee.manage）皆可見
  const showPeople =
    showManager || showAdmin || hasPermission(user, ["org.employee.manage"]);

  // 排班管理：管理者看班表作業，管理員另加排班參數設定
  const scheduleNav: NavItem[] = [
    ...(showManager ? scheduleManagerNav : []),
    ...(showAdmin ? scheduleConfigNav : []),
  ];

  // 組織設定：人員管理（showPeople）、管理員另加門市/權限
  const orgNav: NavItem[] = [
    ...(showPeople ? orgPeopleNav : []),
    ...(showAdmin ? orgAdminNav : []),
  ];

  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarRange className="size-4" />
          </div>
          <span className="text-sm font-semibold">排班系統</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>個人</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavGroup items={personalNav} prefix="self" />
          </SidebarGroupContent>
        </SidebarGroup>

        {scheduleNav.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>排班管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavGroup items={scheduleNav} prefix="sched" />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {orgNav.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>組織設定</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavGroup items={orgNav} prefix="org" />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />

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
