"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BoxesIcon,
  ChartLineIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import type { AuthUser } from "@/server/auth/types"
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
  SidebarRail,
} from "@/components/ui/sidebar"

const navMain = [
  { title: "Dashboard", icon: LayoutDashboardIcon, href: "/" },
  { title: "Entities", icon: BoxesIcon, href: "/entities" },
  {
    title: "Users",
    icon: UsersIcon,
    href: "/users",
    adminOnly: true,
  },
] satisfies {
  title: string
  icon: typeof LayoutDashboardIcon
  href: string
  adminOnly?: boolean
}[]

const navSecondary = [
  { title: "Settings", icon: SettingsIcon },
  { title: "Get help", icon: LifeBuoyIcon },
]

export function AppSidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname()

  const items = navMain.filter((item) => !item.adminOnly || user.role === "admin")

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-xs text-xs font-semibold">
            A
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold tracking-tight">
              Acme Inc
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {user.role === "admin" ? "Admin" : "Distributor"}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={isActive}
                      aria-current={isActive ? "page" : undefined}
                      render={<Link href={item.href} />}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Analytics"
                  render={<Link href="#" />}
                >
                  <ChartLineIcon aria-hidden="true" />
                  <span>Analytics</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Support</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton tooltip={item.title} render={<a href="#" />}>
                    <item.icon aria-hidden="true" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="w-full" tooltip={user.username}>
              <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-xs text-xs font-semibold">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-col text-start">
                <span className="truncate text-sm font-medium">
                  {user.username}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.role}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <SidebarMenuButton
                tooltip="Log out"
                render={<button type="submit" />}
                className="w-full"
              >
                <LogOutIcon aria-hidden="true" />
                <span>Log out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
