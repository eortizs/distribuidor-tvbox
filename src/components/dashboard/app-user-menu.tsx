"use client"

import Link from "next/link"
import { LogOutIcon } from "lucide-react"
import { cn } from "cn"

import { logoutAction } from "@/app/actions/auth"
import { accountNav } from "@/components/dashboard/nav-config"
import { mobileNavClass } from "@/components/dashboard/nav-layout"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AuthUser } from "@/server/auth/types"

/**
 * Menú de cuenta de la cabecera: perfil, gestión de usuarios (solo admin),
 * tema y cierre de sesión.
 */
export function AppUserMenu({ user }: { user: AuthUser }) {
  const items = accountNav.filter(
    (item) => !item.adminOnly || user.role === "admin"
  )
  const initials = user.username.slice(0, 2).toUpperCase()

  return (
    <DropdownMenu>
      <div className="-m-1 p-1">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="lg"
              className="gap-2 px-2"
              aria-label={`Cuenta de ${user.username}`}
            />
          }
        >
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm md:inline">
            {user.username}
          </span>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={8}
        className={cn(mobileNavClass.dropdownContent, "w-56")}
      >
        <DropdownMenuGroup>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              className={mobileNavClass.dropdownItem}
            >
              <item.icon aria-hidden="true" />
              <span>{item.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeToggle />
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={false}
            className={mobileNavClass.dropdownItem}
            render={<button type="submit" className="w-full" />}
          >
            <LogOutIcon aria-hidden="true" />
            <span>Cerrar sesión</span>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
