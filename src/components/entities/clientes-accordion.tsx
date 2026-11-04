"use client"

/**
 * Pantalla Clientes (`/clientes`): listado de clientes del panel de FlujoTV
 * compuesto sobre el ejemplo `c-accordion-9` de ReUI (Frame + Accordion),
 * con filas tipo WhatsApp para lectura cómoda en móvil:
 *
 * - Fila: avatar grande con iniciales (`size-12`); como subtítulo del
 *   nombre, la fecha de vencimiento y el conteo de días restantes
 *   ("vence 27 nov 2026 · 24 días"), con vista previa de correo o plan solo
 *   si el cliente no tiene dato de vencimiento; al margen derecho, punto de
 *   estado (verde activo, rojo vencido, ámbar pendiente, azul prueba; tokens
 *   semánticos) alineado en columna y, a su derecha, la barra de progreso
 *   (`ui/progress`) con
 *   los días restantes en una ventana de urgencia de 30 días — llena con
 *   más de 30 días y agotándose al acercarse el vencimiento (rojo ≤5 días
 *   o dato desconocido, ámbar ≤15, primario el resto).
 * - Sin chevron de expansión ni anillo de foco en el trigger: la fila es el
 *   botón; el detalle vive en el contenido expandido.
 * - Contenido expandido: correo y plan.
 *
 * La pantalla compone además la barra de **filtros** ReUI (`filters` en
 * variante básica, copia en español del Lab) sobre el listado ya descargado:
 * Estado como selección, Reseller con la lista real de resellers del panel
 * (más "Sin reseller"), y Días para vencer con operadores numéricos (igual,
 * comparaciones y rango) y vacío para "sin dato". La barra se compone por
 * piezas (`children` de `Filters` con `FilterChip` + `FiltersBuilder`) para
 * intercalar, tras cada filtro aplicado, un **chip independiente con el
 * contador de instancias** que arroja esa condición, calculado sobre el
 * listado cargado; las opciones del menú llevan además el conteo como
 * subtítulo (`description`). Los conteos van **en cascada**: la primera
 * regla cuenta sobre el listado completo y cada siguiente sobre el
 * resultado de las anteriores (los datos locales que dejó el filtro previo).
 *
 * El dato viene de `GET /api/flujotv/clients`, el mismo endpoint de la
 * pestaña Clientes del Lab; la búsqueda filtra en cliente por usuario/correo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Fragment } from "react"
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
import { Filters } from "@/components/reui/filters/filters"
import { FilterChip } from "@/components/reui/filters/filters-chip"
import { FiltersBuilder } from "@/components/reui/filters/filters-builder"
import { createFilterQuery, flattenFilterRules } from "@/components/reui/filters/filters-query"
import type {
  FilterField,
  FilterOption,
  FilterQuery,
} from "@/components/reui/filters/filters-types"
import type { FilterOperatorLabels } from "@/components/reui/filters/filters-operators"
import {
  formatDaysRemaining,
  formatFlujoDate,
  type FlujoClient,
} from "@/lib/flujotv"

import { fetchFlujoClients, fetchFlujoResellers } from "@/components/lab/flujo-api"
import {
  applyFilterQuery,
  matchesFilterRule,
} from "@/components/lab/filter-utils"
import { LAB_FILTER_LABELS } from "@/components/lab/lab-i18n"

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

/** Color del punto de estado junto al nombre (tokens semánticos de estado). */
function statusDotClass(status: string | null): string {
  switch (status) {
    case "activo":
      return "bg-success"
    case "vencido":
      return "bg-destructive"
    case "pendiente":
      return "bg-warning"
    case "prueba":
      return "bg-info"
    default:
      return "bg-muted-foreground/40"
  }
}

/**
 * Llaves probables del SUB-RESELLER en los datos crudos del cliente. Nunca
 * `reseller`: esa llave es la cuenta padre (p. ej. tvortiztv), constante en
 * todas las filas de `/get_clients`, y taparía al reseller real.
 */
const CLIENT_DISTRIBUTOR_KEYS = ["distributor", "distribuidor"]

function rawClientReseller(client: FlujoClient): string {
  for (const key of CLIENT_DISTRIBUTOR_KEYS) {
    const value = client.raw[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

/** Subtítulo de la opción: cuántos clientes devuelve ese filtro. */
function optionCount(count: number | undefined): string | undefined {
  if (count === undefined) return undefined
  return `${count} ${count === 1 ? "cliente" : "clientes"}`
}

/** Etiquetas en español para los operadores del catálogo de filtros. */
const CLIENT_FILTER_OPERATOR_LABELS: FilterOperatorLabels = {
  contains: "contiene",
  not_contains: "no contiene",
  starts_with: "empieza con",
  ends_with: "termina con",
  is: "es",
  is_not: "no es",
  is_any_of: "es alguno de",
  is_none_of: "no es ninguno de",
  eq: "es igual a",
  neq: "no es igual a",
  gt: "mayor que",
  gte: "mayor o igual que",
  lt: "menor que",
  lte: "menor o igual que",
  between: "entre",
  not_between: "fuera de",
  empty: "está vacío",
  not_empty: "no está vacío",
}

export function ClientesAccordion() {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [resellerNames, setResellerNames] = useState<string[]>([])
  const [userResellers, setUserResellers] = useState<Record<string, string>>({})
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [reloadCount, setReloadCount] = useState(0)

  const requestCounter = useRef(0)

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoClients({})
      .then(async (data) => {
        // El filtro de reseller usa la lista real del panel y el mapa
        // usuario → reseller de `/users/validity`; si esa parte falla,
        // el listado carga igual y el filtro queda sin opciones.
        const { names, byUser } = await fetchFlujoResellers()
          .then((resellersData) => ({
            names: resellersData.resellers
              .map((reseller) => reseller.name)
              .filter(Boolean),
            byUser: resellersData.userResellers ?? {},
          }))
          .catch(
            () =>
              ({
                names: [] as string[],
                byUser: {} as Record<string, string>,
              }) as { names: string[]; byUser: Record<string, string> }
          )
        if (requestId !== requestCounter.current) return
        setClients(data.clients)
        setResellerNames(names)
        setUserResellers(byUser)
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

  /** Reseller del cliente: llave cruda si viene, si no el mapa de `/users/validity`. */
  const resellerOf = useCallback(
    (client: FlujoClient): string => {
      const fromRaw = rawClientReseller(client)
      if (fromRaw) return fromRaw
      return userResellers[client.userName.trim().toLowerCase()] ?? ""
    },
    [userResellers]
  )

  const reload = useCallback(() => {
    setFetchState("loading")
    setReloadCount((token) => token + 1)
  }, [])

  /** Facetas por opción, calculadas sobre el listado cargado. */
  const estadoCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const client of clients) {
      counts.set(client.statusLabel, (counts.get(client.statusLabel) ?? 0) + 1)
    }
    return counts
  }, [clients])

  const resellerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const client of clients) {
      const reseller = resellerOf(client)
      counts.set(reseller, (counts.get(reseller) ?? 0) + 1)
    }
    return counts
  }, [clients, resellerOf])

  /** Opciones de reseller: la lista real del panel, más "Sin reseller". */
  const resellerOptions = useMemo<FilterOption[]>(
    () => [
      ...[...new Set(resellerNames)]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((name) => ({
          value: name,
          label: name,
          description: optionCount(resellerCounts.get(name)),
        })),
      {
        value: "",
        label: "Sin reseller",
        exclusive: true,
        description: optionCount(resellerCounts.get("")),
      },
    ],
    [resellerNames, resellerCounts]
  )

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        id: "estado",
        label: "Estado",
        type: "select",
        options: (
          [
            { value: "activo", label: "Activo" },
            { value: "vencido", label: "Vencido" },
            { value: "pendiente", label: "Pendiente" },
            { value: "prueba", label: "Prueba" },
          ] as const
        ).map((option) => ({
          ...option,
          description: optionCount(estadoCounts.get(option.value)),
        })),
      },
      {
        id: "reseller",
        label: "Reseller",
        type: "select",
        options: resellerOptions,
      },
      {
        id: "dias",
        label: "Días para vencer",
        type: "number",
      },
    ],
    [estadoCounts, resellerOptions]
  )

  const filtered = useMemo(() => {
    const byQuery = applyFilterQuery(clients, query, {
      estado: (row) => row.statusLabel,
      reseller: resellerOf,
      dias: (row) => row.daysRemaining,
    })
    const term = searchInput.trim().toLowerCase()
    if (!term) return byQuery
    return byQuery.filter(
      (client) =>
        client.userName.toLowerCase().includes(term) ||
        (client.email ?? "").toLowerCase().includes(term)
    )
  }, [clients, query, searchInput, resellerOf])

  const searching = searchInput.trim().length > 0
  const hasFilters = query.rules.length > 0
  const rules = useMemo(() => flattenFilterRules(query), [query])

  /** Conteos en cascada: cada regla cuenta sobre el resultado de la anterior. */
  const ruleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    let rows = clients
    for (const rule of rules) {
      const accessor =
        rule.path[0] === "estado"
          ? (row: FlujoClient) => row.statusLabel
          : rule.path[0] === "reseller"
            ? resellerOf
            : rule.path[0] === "dias"
              ? (row: FlujoClient) => row.daysRemaining
              : null
      if (!accessor) continue
      rows = rows.filter((row) => matchesFilterRule(rule, row, accessor))
      counts.set(rule.id, rows.length)
    }
    return counts
  }, [clients, rules, resellerOf])

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

      {fetchState === "success" && clients.length > 0 ? (
        <Filters
          fields={filterFields}
          query={query}
          onQueryChange={setQuery}
          labels={LAB_FILTER_LABELS}
          operatorLabels={CLIENT_FILTER_OPERATOR_LABELS}
          size="sm"
        >
          <div
            role="toolbar"
            aria-label={LAB_FILTER_LABELS.filtersLabel}
            className="flex flex-wrap items-center gap-2"
          >
            {rules.map((rule, index) => {
              const count = ruleCounts.get(rule.id)
              return (
                <Fragment key={rule.id}>
                  <FilterChip rule={rule} index={index} />
                  {count !== undefined ? (
                    <Badge
                      variant="outline"
                      size="xl"
                      className="rounded-full px-3 tabular-nums"
                    >
                      {count}
                    </Badge>
                  ) : null}
                </Fragment>
              )
            })}
            <FiltersBuilder />
          </div>
        </Filters>
      ) : null}

      {fetchState === "loading" ? (
        <div className="flex flex-col" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`flex items-center gap-3 px-1.5 py-2.5 ${index > 0 ? "border-t" : ""}`}
            >
              <Skeleton className="size-12 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3.5 w-48 max-w-full" />
              </div>
              <Skeleton className="ml-auto h-1 w-16 shrink-0 rounded-full" />
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
          Ningún cliente coincide con la búsqueda o los filtros.
        </p>
      ) : (
        <Accordion multiple={false}>
          {filtered.map((client) => (
            <AccordionItem
              key={client.id}
              value={client.id}
              className="bg-transparent p-0"
            >
              <AccordionTrigger className="items-center gap-3 rounded-lg px-1.5 py-2.5 hover:bg-muted hover:no-underline focus-visible:border-transparent focus-visible:ring-0 dark:hover:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden">
                <Avatar className="size-12">
                  <AvatarFallback>{initials(client.userName)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <span className="truncate text-base font-semibold tracking-tight">
                    {client.userName}
                  </span>
                  {client.expiresAt || client.daysRemaining !== null ? (
                    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                      <span className="truncate">
                        vence {formatFlujoDate(client.expiresAt)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                      />
                      <span className="tabular-nums">
                        {formatDaysRemaining(client.daysRemaining)}
                      </span>
                    </span>
                  ) : client.email || client.plan ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {client.email ?? client.plan}
                    </span>
                  ) : null}
                </div>
                <div className="flex w-4 shrink-0 items-center justify-center">
                  <span
                    role="img"
                    aria-label={client.statusLabel}
                    className={`size-2.5 rounded-full ${statusDotClass(client.status)}`}
                  />
                </div>
                <Progress
                  value={expiryProgress(client.daysRemaining)}
                  aria-label={`Días restantes de ${client.userName}`}
                  className={`w-16 shrink-0 ${expiryProgressClass(client.daysRemaining)}`}
                />
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
                <div className="flex flex-col gap-1 pb-1 text-xs">
                  <span className="truncate">
                    {client.email ?? "Sin correo"}
                  </span>
                  <span>{client.plan ?? "Sin plan"}</span>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {fetchState === "success" && clients.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {searching || hasFilters
            ? `${filtered.length} de ${clients.length} clientes`
            : `${clients.length} clientes`}
        </p>
      ) : null}
    </div>
  )
}
