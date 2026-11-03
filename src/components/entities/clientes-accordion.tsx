"use client"

/**
 * Pantalla Clientes (`/clientes`): listado de clientes del panel de FlujoTV
 * compuesto sobre el ejemplo `c-accordion-9` de ReUI (Frame + Accordion).
 *
 * - Fila: avatar con iniciales, nombre de usuario y chip de estado
 *   (`statusBadgeVariant` según la licencia).
 * - Contenido expandido: correo, plan, vencimiento y días restantes.
 * - Margen derecho: barra de progreso (`ui/progress`) con los días restantes
 *   en una ventana de urgencia de 30 días — llena con más de 30 días y
 *   agotándose al acercarse el vencimiento (rojo ≤5 días o dato desconocido,
 *   ámbar ≤15, primario el resto).
 *
 * El dato viene de `GET /api/flujotv/clients`, el mismo endpoint de la
 * pestaña Clientes del Lab; la búsqueda filtra en cliente por usuario/correo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PackageOpenIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  formatDaysRemaining,
  formatFlujoDate,
  statusBadgeVariant,
  type FlujoClient,
} from "@/lib/flujotv"

import { fetchFlujoClients } from "@/components/lab/flujo-api"

type FetchState = "loading" | "success" | "error"

/** Iniciales del avatar a partir del nombre de usuario. */
function initials(userName: string): string {
  const parts = userName.trim().split(/[\s._-]+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? ""
  const second = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? ""
  return (first + second).toUpperCase()
}

/** Ventana de urgencia: la barra se agota durante los 30 días previos al vencimiento. */
const PROGRESS_WINDOW_DAYS = 30

function expiryProgress(days: number | null): number {
  if (days === null || days <= 0) return 0
  return Math.min((days / PROGRESS_WINDOW_DAYS) * 100, 100)
}

/** Tono del indicador según los días restantes. */
function expiryProgressClass(days: number | null): string {
  if (days === null || days <= 5)
    return "[&_[data-slot=progress-indicator]]:bg-destructive"
  if (days <= 15) return "[&_[data-slot=progress-indicator]]:bg-warning"
  return ""
}

export function ClientesAccordion() {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [reloadCount, setReloadCount] = useState(0)

  const requestCounter = useRef(0)

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoClients({})
      .then((data) => {
        if (requestId !== requestCounter.current) return
        setClients(data.clients)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((error: unknown) => {
        if (requestId !== requestCounter.current) return
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los clientes."
        )
        setFetchState("error")
      })
  }, [reloadCount])

  const reload = useCallback(() => {
    setFetchState("loading")
    setReloadCount((token) => token + 1)
  }, [])

  const filtered = useMemo(() => {
    const term = searchInput.trim().toLowerCase()
    if (!term) return clients
    return clients.filter(
      (client) =>
        client.userName.toLowerCase().includes(term) ||
        (client.email ?? "").toLowerCase().includes(term)
    )
  }, [clients, searchInput])

  const searching = searchInput.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente por usuario o correo"
          className="w-full max-w-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={fetchState === "loading"}
        >
          <RefreshCwIcon aria-hidden="true" />
          Recargar
        </Button>
      </div>

      {fetchState === "loading" ? (
        <div className="flex flex-col" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-2 px-1 py-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : fetchState === "error" ? (
        <Empty className="border border-dashed" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCwIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No se pudieron cargar los clientes</EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={reload}>
              Reintentar
            </Button>
          </EmptyContent>
        </Empty>
      ) : clients.length === 0 ? (
        <Empty className="border border-dashed" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpenIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>El panel no devolvió clientes</EmptyTitle>
            <EmptyDescription>
              Refresca los datos del panel desde Lab para sincronizarlos.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={reload}>
              Recargar
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          Ningún cliente coincide con la búsqueda.
        </p>
      ) : (
        <Accordion multiple={false} className="border-none">
          {filtered.map((client) => (
            <AccordionItem
              key={client.id}
              value={client.id}
              className="border-none bg-transparent p-0 **:data-[slot=accordion-content]:p-0!"
            >
              <AccordionTrigger className="items-center px-1 py-1 hover:no-underline [&_[data-slot=accordion-trigger-icon]]:hidden">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">
                      {initials(client.userName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="inline-flex items-center gap-2">
                    <span className="text-foreground/90 font-semibold tracking-tight">
                      {client.userName}
                    </span>
                    <Badge
                      variant={statusBadgeVariant(client.status)}
                      size="sm"
                    >
                      {client.statusLabel}
                    </Badge>
                  </div>
                  <Progress
                    value={expiryProgress(client.daysRemaining)}
                    aria-label={`Días restantes de ${client.userName}`}
                    className={`ml-auto w-16 ${expiryProgressClass(client.daysRemaining)}`}
                  />
                </div>
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground py-0 pl-11">
                <div className="flex flex-col gap-1 text-xs">
                  <span className="truncate">
                    {client.email ?? "Sin correo"}
                  </span>
                  <span className="truncate">
                    {client.plan ?? "Sin plan"} · vence{" "}
                    {formatFlujoDate(client.expiresAt)} ·{" "}
                    {formatDaysRemaining(client.daysRemaining)}
                  </span>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {fetchState === "success" && clients.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {searching
            ? `${filtered.length} de ${clients.length} clientes`
            : `${clients.length} clientes`}
        </p>
      ) : null}
    </div>
  )
}
