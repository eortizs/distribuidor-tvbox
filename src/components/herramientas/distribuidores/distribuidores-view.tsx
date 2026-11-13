"use client"

/**
 * Módulo Distribuidores (`/modulos/distribuidores`, solo admin): listado de
 * las cuentas con rol `distribuidor` filtradas del listado de `/users`,
 * presentadas con las mismas filas de `/clientes` (acordeón estilo WhatsApp:
 * avatar grande con iniciales pastel, título, subtítulo y dato compacto) y
 * gestionadas con el mismo menú contextual de `/users`:
 *
 * - Fila: avatar `size-12` con iniciales pastel (misma paleta que
 *   `/clientes`, `lib/avatar`); como título, el correo de la cuenta con el
 *   badge «Google» si está ligada a OAuth; como subtítulo, el reseller de
 *   FlujoTV ligado («Panel FlujoTV: …») o «Sin panel de FlujoTV ligado»; y
 *   como dato compacto, cuántos clientes tiene asignados. Al margen derecho,
 *   punto de estado (verde con panel ligado, ámbar sin ligar: tokens
 *   semánticos, misma geometría del semáforo de `/clientes`).
 * - Contenido expandido: fecha de alta y los dos saldos vigentes de la
 *   cuenta (cupones y tokens), el dato que el admin necesita a la vista
 *   antes de abonar o editar.
 * - Botón de **gestión** (settings-2 de lucide) en la posición del carrito
 *   de `/clientes` (capa absoluta `right-8`, táctil 36×36, feedback de
 *   pulsación de la casa): abre el mismo `UserActionsMenu` de `/users` —
 *   Saldo, Permisos, Editar y Eliminar — con sus diálogos intactos.
 * - Buscador idéntico al de `/clientes` (píldora con lupa y X de limpieza):
 *   filtra por correo o panel ligado, sin acentos.
 *
 * El dato llega ya filtrado del servidor (la página solo pasa cuentas
 * distribuidoras): sin estados de carga propios; vacío y sin coincidencias
 * cubren el resto.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  PackageOpenIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react"

import { UserActionsMenu, type UserListItem } from "@/components/auth/users-list"
import { Badge } from "@/components/reui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { initials, pastelAvatarStyle } from "@/lib/avatar"
import { formatMxn } from "@/lib/finanzas"

/**
 * Normaliza para comparar textos: minúsculas y sin acentos, igual que la
 * búsqueda de `/clientes` y del hub de módulos («maria» encuentra «María»).
 */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Clases del botón de gestión: la misma cápsula del carrito de `/clientes`. */
const ACTION_TRIGGER_CLASS =
  "pointer-events-auto h-9 w-9 shrink-0 rounded-full text-black dark:text-white transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 active:bg-primary/15 active:text-primary motion-reduce:active:scale-100"

/** Color del punto de estado junto al nombre (tokens semánticos de estado). */
function linkDotClass(user: UserListItem): string {
  return user.distribuidorName ? "bg-success" : "bg-warning"
}

export function DistribuidoresView({
  users,
  currentUserId,
  couponDailyLimitDefault,
  couponMonthlyLimitDefault,
}: {
  /** Cuentas con rol `distribuidor`, ya filtradas en el servidor. */
  users: UserListItem[]
  /** Cuenta del admin conectado: oculta la acción destructiva en su fila. */
  currentUserId: string
  /** Tope diario global (`COUPON_QA_DAILY_LIMIT`), para el diálogo Permisos. */
  couponDailyLimitDefault: number
  /** Tope mensual global (`COUPON_QA_MONTHLY_LIMIT`), para el diálogo Permisos. */
  couponMonthlyLimitDefault: number
}) {
  const [searchInput, setSearchInput] = useState("")

  const filtered = useMemo(() => {
    const term = foldTerm(searchInput)
    if (!term) return users
    return users.filter(
      (user) =>
        foldTerm(user.username).includes(term) ||
        foldTerm(user.distribuidorName ?? "").includes(term)
    )
  }, [users, searchInput])

  const searching = searchInput.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      {/*
       * Buscador (misma composición que /clientes): píldora redondeada con
       * lupa y botón de limpieza (X) visible solo con texto.
       */}
      <div className="flex items-center gap-2">
        <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
          <InputGroupAddon align="inline-start" className="pl-3.5">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar distribuidor por correo o panel ligado"
            className="h-full text-base"
          />
          {searching ? (
            <InputGroupAddon align="inline-end" className="mr-0 pr-2.5">
              <InputGroupButton
                size="icon-sm"
                className="size-9 rounded-full"
                onClick={() => setSearchInput("")}
                aria-label="Limpiar búsqueda"
              >
                <XIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      {users.length === 0 ? (
        <Empty className="border border-dashed" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpenIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Sin cuentas distribuidoras</EmptyTitle>
            <EmptyDescription>
              Crea la primera cuenta con rol distribuidor desde Usuarios →
              Nuevo usuario; aparecerá aquí para gestionarla.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="ghost" render={<Link href="/users" />}>
              Abrir Usuarios
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          Ningún distribuidor coincide con la búsqueda.
        </p>
      ) : (
        <Accordion multiple={false}>
          {filtered.map((user) => (
            <AccordionItem
              key={user.id}
              value={user.id}
              className="not-last:border-b-0 bg-transparent p-0"
            >
              <div className="relative">
                <AccordionTrigger className="items-center gap-3 rounded-lg px-1.5 py-2.5 hover:bg-muted hover:no-underline focus-visible:border-transparent focus-visible:ring-0 dark:hover:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden">
                  <Avatar className="size-12">
                    <AvatarFallback style={pastelAvatarStyle(user.id || user.username)}>
                      {initials(user.username)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-14">
                    <span className="text-foreground inline-flex items-center gap-2 truncate text-base font-semibold tracking-tight">
                      <span className="truncate">{user.username}</span>
                      {user.googleLinked ? (
                        <Badge variant="secondary" size="sm">
                          Google
                        </Badge>
                      ) : null}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {user.distribuidorName
                        ? `Panel FlujoTV: ${user.distribuidorName}`
                        : "Sin panel de FlujoTV ligado"}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {user.entityCount}{" "}
                      {user.entityCount === 1 ? "cliente" : "clientes"}
                    </span>
                  </div>
                  <div className="flex w-4 shrink-0 items-center justify-center">
                    <span
                      role="img"
                      aria-label={
                        user.distribuidorName
                          ? "Panel de FlujoTV ligado"
                          : "Sin panel de FlujoTV ligado"
                      }
                      className={`size-2.5 rounded-full ${linkDotClass(user)}`}
                    />
                  </div>
                </AccordionTrigger>
                {/*
                 * Botón de gestión (settings-2): misma capa absoluta del
                 * carrito de /clientes — hermano del trigger, no descendiente,
                 * y solo el botón recibe toques.
                 */}
                <div className="pointer-events-none absolute inset-y-0 right-8 z-10 flex items-center">
                  <UserActionsMenu
                    user={user}
                    isSelf={user.id === currentUserId}
                    couponDailyLimitDefault={couponDailyLimitDefault}
                    couponMonthlyLimitDefault={couponMonthlyLimitDefault}
                    modulesManagement
                    triggerIcon={
                      <Settings2Icon aria-hidden="true" className="size-5" />
                    }
                    triggerClassName={ACTION_TRIGGER_CLASS}
                  />
                </div>
              </div>
              <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
                <div className="flex flex-col gap-1 pb-1 text-xs">
                  <span className="truncate">alta {user.createdAtLabel}</span>
                  <span className="truncate">
                    saldo cupones {formatMxn(user.saldoCupones)} · saldo tokens{" "}
                    {formatMxn(user.saldoTokens)}
                  </span>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {users.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {searching
            ? `${filtered.length} de ${users.length} distribuidores`
            : `${users.length} ${users.length === 1 ? "distribuidor" : "distribuidores"}`}
        </p>
      ) : null}
    </div>
  )
}
