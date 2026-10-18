"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Collapsible } from "@base-ui/react/collapsible"
import {
  ChartLineIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ImageIcon,
  LogOutIcon,
} from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import type { AuthUser } from "@/server/auth/types"
import { ToguLogo } from "@/components/togu-logo"
import {
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
        <div className="flex items-center gap-2 px-2 py-1.5">
          <ToguLogo />
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold tracking-tight">
              Togu
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {user.role === "admin" ? "Admin" : "Distributor"}
            </span>
          </div>
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
              <Collapsible.Root defaultOpen={pathname.startsWith("/herramientas")}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={herramientasNav.title}
                    isActive={pathname.startsWith("/herramientas")}
                    render={<Collapsible.Trigger className="w-full" />}
                  >
                    <ImageIcon aria-hidden="true" />
                    <span>{herramientasNav.title}</span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="ms-auto transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[panel-open]/menu-button:rotate-90"
                    />
                  </SidebarMenuButton>
                  <Collapsible.Panel>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          size="sm"
                          isActive={pathname.startsWith("/herramientas/imagenes")}
                          render={
                            <Link
                              href={herramientasNav.href}
                              onClick={closeMobilePanel}
                            />
                          }
                        >
                          <span>{herramientasNav.childTitle}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </Collapsible.Panel>
                </SidebarMenuItem>
              </Collapsible.Root>
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
                  <span className="text-muted-foreground truncate text-xs">
                    {user.role}
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
