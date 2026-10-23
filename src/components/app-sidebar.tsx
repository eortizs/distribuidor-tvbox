"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChartLineIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
} from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import type { AuthUser } from "@/server/auth/types"
import { ThemeToggle } from "@/components/theme-toggle"
import { MascotaLogo } from "@/components/mascota-logo"
import { TvboxWordmark } from "@/components/tvbox-wordmark"
import {
  finanzasNav,
  groupLabels,
  herramientasNav,
  navMain,
  navSecondary,
  profileNav,
} from "@/components/dashboard/nav-config"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
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

export function AppSidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  // The mobile sidebar is an overlay panel: close it on any navigation so it
  // does not cover the destination screen.
  const closeMobilePanel = () => setOpenMobile(false)

  const items = navMain.filter((item) => !item.adminOnly || user.role === "admin")

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <TvboxWordmark className="group-data-[collapsible=icon]:hidden" />
            <MascotaLogo />
          </div>
          <span className="mt-1.5 block truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Distribuidor
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{groupLabels.main}</SidebarGroupLabel>
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
                      render={
                        <Link href={item.href} onClick={closeMobilePanel} />
                      }
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
                  render={
                    <Link href="#" onClick={closeMobilePanel} />
                  }
                >
                  <ChartLineIcon aria-hidden="true" />
                  <span>Analytics</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{herramientasNav.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {herramientasNav.children.map((child) => {
                const isActive = pathname.startsWith(child.href)
                return (
                  <SidebarMenuItem key={child.href}>
                    <SidebarMenuButton
                      tooltip={child.title}
                      isActive={isActive}
                      aria-current={isActive ? "page" : undefined}
                      render={
                        <Link href={child.href} onClick={closeMobilePanel} />
                      }
                    >
                      <child.icon aria-hidden="true" />
                      <span>{child.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{finanzasNav.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {finanzasNav.children.map((child) => {
                const isActive = pathname.startsWith(child.href)
                return (
                  <SidebarMenuItem key={child.href}>
                    <SidebarMenuButton
                      tooltip={child.title}
                      isActive={isActive}
                      aria-current={isActive ? "page" : undefined}
                      render={
                        <Link href={child.href} onClick={closeMobilePanel} />
                      }
                    >
                      <child.icon aria-hidden="true" />
                      <span>{child.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{groupLabels.support}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
                {navSecondary.map((item) => {
                  const isActive = item.href
                    ? pathname.startsWith(item.href)
                    : false
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={isActive}
                        aria-current={isActive ? "page" : undefined}
                        render={
                          item.href ? (
                            <Link
                              href={item.href}
                              onClick={closeMobilePanel}
                            />
                          ) : (
                            <a href="#" onClick={closeMobilePanel} />
                          )
                        }
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" className="w-full" />}
              >
                <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-xs text-xs font-semibold">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-col text-start">
                  <span className="truncate text-sm font-medium">
                    {user.username}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ms-auto" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={
                      <Link href={profileNav.href} onClick={closeMobilePanel} />
                    }
                  >
                    {profileNav.title}
                  </DropdownMenuItem>
                  <DropdownMenuItem>Billing</DropdownMenuItem>
                  <DropdownMenuItem>Notifications</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <ThemeToggle />
                <DropdownMenuSeparator />
                <form action={logoutAction}>
                  <DropdownMenuItem
                    variant="destructive"
                    closeOnClick={false}
                    render={<button type="submit" className="w-full" />}
                  >
                    <LogOutIcon aria-hidden="true" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
