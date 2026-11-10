"use client"

import Link from "next/link"
import { CoinsIcon, LogOutIcon } from "lucide-react"
import { cn } from "cn"

import { logoutAction } from "@/app/actions/auth"
import { accountNav } from "@/components/dashboard/nav-config"
import { mobileNavClass } from "@/components/dashboard/nav-layout"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatMxn } from "@/lib/finanzas"
import type { AuthUser } from "@/server/auth/types"

/**
 * Menú de cuenta de la cabecera: perfil, saldo disponible con divider
 * (solo si el comprador ve la sección de módulos; un toque lleva a «Abonar
 * saldo»), gestión de usuarios (solo admin), tema y cierre de sesión. El
 * monto vive como prop del servidor: el SSE refresca el layout y el menú
 * se abre siempre con el valor vigente.
 */
export function AppUserMenu({
  user,
  saldo,
}: {
  user: AuthUser
  /** Saldo disponible (MXN) para el primer renglón; null oculta el renglón. */
  saldo: number | null
}) {
  const mainItems = accountNav.filter((item) => !item.adminOnly)
  const adminItems = accountNav.filter(
    (item) => item.adminOnly && user.role === "admin"
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
          <Avatar>
            {user.googlePicture ? (
              <AvatarImage
                src={user.googlePicture}
                alt={`Foto de perfil de ${user.username}`}
                referrerPolicy="no-referrer"
              />
            ) : null}
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
          {mainItems.map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              className={mobileNavClass.dropdownItem}
            >
              <item.icon aria-hidden="true" />
              <span>{item.title}</span>
            </DropdownMenuItem>
          ))}
          {saldo !== null ? (
            <DropdownMenuItem
              render={<Link href="/modulos/abonar-saldo" />}
              className={mobileNavClass.dropdownItem}
            >
              <CoinsIcon aria-hidden="true" />
              <span>Saldo</span>
              <span className="ml-auto font-medium tabular-nums">
                {formatMxn(saldo)}
              </span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {adminItems.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {adminItems.map((item) => (
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
          </>
        ) : null}
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
