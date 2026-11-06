"use client"

/**
 * Pantalla Clientes (`/clientes`): listado de clientes del panel de FlujoTV
 * compuesto sobre el ejemplo `c-accordion-9` de ReUI (Frame + Accordion),
 * con filas tipo WhatsApp para lectura cómoda en móvil:
 *
 * - Fila: avatar grande con iniciales (`size-12`); como subtítulo del
 *   nombre, la fecha de vencimiento ("vence 27 nov 2026") y, debajo, la
 *   barra de progreso (`ui/progress`) con el conteo compacto de días
 *   restantes a su derecha ("32d"); con vista previa de correo o plan solo
 *   si el cliente no tiene dato de vencimiento. Al margen derecho, punto de
 *   estado (verde activo, rojo vencido, ámbar pendiente, azul prueba; tokens
 *   semánticos). La barra recorre
 *   los días restantes en una ventana de urgencia de 30 días — llena con
 *   más de 30 días y agotándose al acercarse el vencimiento (rojo ≤5 días
 *   o dato desconocido, ámbar ≤15, primario el resto).
 * - Sin chevron de expansión ni anillo de foco en el trigger: la fila es el
 *   botón; el detalle vive en el contenido expandido.
 * - Contenido expandido: correo y plan.
 *
 * Cada fila lleva además el botón de **compra rápida** (shopping-cart-plus
 * de lucide), colocado entre el contenido y el punto de estado:
 *
 * - Posición: capa absoluta sobre la fila (`inset-y-0`, centrada en
 *   vertical con flex) a la izquierda del semáforo; la capa es
 *   `pointer-events-none` y solo el botón recibe toques, así el resto de la
 *   fila sigue alternando el acordeón. El botón es hermano del trigger y no
 *   descendiente: un `<button>` anidado rompería el HTML y la hidratación.
 * - Tamaño móvil: blanco táctil de 44×44 px (`size-11`) con icono de 28 px
 *   (`size-7`) en negro puro (`text-black`).
 * - Feedback de pulsación: escala a 90 % con fondo `primary/15` e icono
 *   `primary` (curva de la casa, 200 ms); con `motion-reduce` se conserva
 *   solo el cambio de color.
 * - Flujo: al pulsar abre un AlertDialog de confirmación con el resumen de
 *   la operación (usuario, renovación de 1 mes, vigencia actual). Confirmar
 *   ejecuta `POST /api/flujotv/renewals` (months 1) con clave de
 *   idempotencia `compra-<uuid>` que se conserva mientras se repita el
 *   mismo cliente sin éxito: un reintento tras un error de red no cobra dos
 *   veces; al éxito la clave se consume. El diálogo no se cierra mientras
 *   procesa (Escape ignorado) y los fallos avisan con toast además del
 *   Alert dentro del diálogo.
 * - Tras el éxito la fila se refresca con una lectura en vivo del cliente
 *   (`GET /api/flujotv/clients/{usuario}` → `/find_user`, sin caché) en vez
 *   de recargar el listado: el listado viene del snapshot cacheado del panel
 *   y no reflejaría la renovación, y presentar vencimiento viejo como fresco
 *   invitaría a comprar dos veces.
 *
 * La pantalla compone además la barra de **filtros** ReUI (`filters` en
 * variante básica, copia en español del Lab) sobre el listado ya descargado:
 * Estado como selección, Distribuidor con la lista real de resellers del panel
 * (más "Sin distribuidor"), y Días para vencer con operadores numéricos (igual,
 * comparaciones y rango) y vacío para "sin dato"; toda regla de días excluye
 * a los clientes vencidos. La barra se compone por
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
 * Con perfil distribuidor el servidor ya entrega solo los clientes de su
 * reseller ligado (prop `distribuidorName`): en ese caso la barra omite el
 * filtro de Distribuidor — todas las filas comparten el mismo — y no consulta
 * `/api/flujotv/resellers`, cuyo listado completo no le compete.
 * El botón de recargar (icono a la derecha de la búsqueda) dispara la
 * sincronización real (`POST /api/flujotv/refresh`, target `list_clients`
 * con `skip_cache=true`): login en el panel y extracción de los datos
 * actualizados, ~90 s, con confirmación previa; los botones de estado vacío
 * reintentan o sincronizan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Fragment } from "react"
import {
  ListFilterPlusIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  ShoppingCartPlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { createFilterQuery, flattenFilterRules, isFilterRuleComplete } from "@/components/reui/filters/filters-query"
import type {
  FilterField,
  FilterOption,
  FilterQuery,
} from "@/components/reui/filters/filters-types"
import type { FilterOperatorLabels } from "@/components/reui/filters/filters-operators"
import {
  formatFlujoDate,
  type FlujoClient,
} from "@/lib/flujotv"

import {
  fetchFlujoClient,
  fetchFlujoClients,
  fetchFlujoResellers,
  refreshFlujo,
  renewFlujoLicense,
} from "@/components/lab/flujo-api"
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

/** Conteo compacto de días junto a la barra: «32d»; «—» sin dato. */
function formatDaysCompact(days: number | null): string {
  if (days === null) return "—"
  return `${days}d`
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

export function ClientesAccordion({
  distribuidorName = null,
}: {
  /** Reseller ligado a la cuenta (perfil distribuidor); null = sin alcance. */
  distribuidorName?: string | null
}) {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [resellerNames, setResellerNames] = useState<string[]>([])
  const [userResellers, setUserResellers] = useState<Record<string, string>>({})
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [reloadCount, setReloadCount] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseTarget, setPurchaseTarget] = useState<FlujoClient | null>(null)
  const [purchaseKey, setPurchaseKey] = useState("")
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  const requestCounter = useRef(0)

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoClients({})
      .then(async (data) => {
        // El filtro de reseller usa la lista real del panel y el mapa
        // usuario → reseller de `/users/validity`; si esa parte falla,
        // el listado carga igual y el filtro queda sin opciones. Con
        // alcance de distribuidor se omite: el listado ya llega filtrado
        // del servidor y el filtro de Distribuidor no se muestra.
        const scoped = { names: [], byUser: {} } as {
          names: string[]
          byUser: Record<string, string>
        }
        const { names, byUser } = distribuidorName
          ? scoped
          : await fetchFlujoResellers()
              .then((resellersData) => ({
                names: resellersData.resellers
                  .map((reseller) => reseller.name)
                  .filter(Boolean),
                byUser: resellersData.userResellers ?? {},
              }))
              .catch(() => scoped)
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
  }, [reloadCount, distribuidorName])

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

  /**
   * Sincronización real con el panel de FlujoTV: el servidor hace login en el
   * sitio (`GET /list_clients` con `skip_cache=true`) y extrae los clientes
   * actualizados; tarda alrededor de 90 segundos. Al terminar recarga el
   * listado; mientras tanto se siguen mostrando los datos ya cargados.
   */
  const runSync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await refreshFlujo("list_clients")
      toast.success("Clientes sincronizados con el panel", {
        description: `Extracción real completada en ${(result.durationMs / 1000).toFixed(1)} s.`,
      })
      reload()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo sincronizar con el panel de FlujoTV."
      )
    } finally {
      setSyncing(false)
      setSyncOpen(false)
    }
  }, [reload])

  const openPurchase = useCallback(
    (client: FlujoClient) => {
      if (purchaseTarget?.id !== client.id || !purchaseKey) {
        setPurchaseKey(`compra-${crypto.randomUUID()}`)
      }
      setPurchaseTarget(client)
      setPurchaseError(null)
      setPurchaseOpen(true)
    },
    [purchaseTarget, purchaseKey]
  )

  const submitPurchase = useCallback(async () => {
    if (!purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    setPurchasing(true)
    setPurchaseError(null)
    try {
      await renewFlujoLicense({
        userName,
        months: 1,
        idempotencyKey: purchaseKey,
      })
      toast.success("Renovación registrada", {
        description: `${userName} · 1 mes`,
      })
      setPurchaseKey("")
      setPurchaseOpen(false)
      fetchFlujoClient(userName)
        .then((fresh) => {
          if (fresh) {
            setClients((rows) =>
              rows.map((row) => (row.id === fresh.id ? fresh : row))
            )
          }
        })
        .catch(() => {})
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar la compra."
      setPurchaseError(message)
      toast.error(message)
    } finally {
      setPurchasing(false)
    }
  }, [purchaseTarget, purchaseKey])

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

  /** Opciones de distribuidor: la lista real del panel, más "Sin distribuidor". */
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
        label: "Sin distribuidor",
        exclusive: true,
        description: optionCount(resellerCounts.get("")),
      },
    ],
    [resellerNames, resellerCounts]
  )

  const filterFields = useMemo<FilterField[]>(() => {
    const fields: FilterField[] = [
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
    ]
    // Con alcance de distribuidor todas las filas comparten el mismo
    // reseller: el filtro no aporta nada y la lista de opciones del panel
    // no le compete al perfil.
    if (!distribuidorName) {
      fields.push({
        id: "reseller",
        label: "Distribuidor",
        type: "select",
        options: resellerOptions,
      })
    }
    fields.push({
      id: "dias",
      label: "Días para vencer",
      type: "number",
    })
    return fields
  }, [estadoCounts, resellerOptions, distribuidorName])

  const filtered = useMemo(() => {
    // El filtro «Días para vencer» solo considera clientes vigentes: cualquier
    // regla sobre días excluye a los vencidos, aunque el operador numérico
    // (p. ej. «menor que») los incluyera por sus días negativos.
    const hasDiasRule = flattenFilterRules(query).some(
      (rule) => rule.path[0] === "dias" && isFilterRuleComplete(rule)
    )
    const eligible = hasDiasRule
      ? clients.filter((client) => client.statusLabel !== "vencido")
      : clients
    const byQuery = applyFilterQuery(eligible, query, {
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
      rows = rows.filter((row) =>
        rule.path[0] === "dias" && row.statusLabel === "vencido"
          ? false
          : matchesFilterRule(rule, row, accessor)
      )
      counts.set(rule.id, rows.length)
    }
    return counts
  }, [clients, rules, resellerOf])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar"
          aria-label="Buscar cliente por usuario o correo"
          className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted px-4 focus-visible:border-transparent"
        />
        <Button
          variant="ghost"
          onClick={() => setSyncOpen(true)}
          disabled={fetchState === "loading" || syncing}
          aria-label="Sincronizar los clientes con el panel de FlujoTV"
          className="size-12 shrink-0 rounded-full [&_svg]:size-6"
        >
          {syncing ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCwIcon aria-hidden="true" />
          )}
        </Button>
      </div>

      {syncing ? (
        <p
          className="text-muted-foreground text-xs"
          role="status"
          aria-live="polite"
        >
          Sincronizando con el panel de FlujoTV: login y extracción de los
          datos actualizados (tarda alrededor de 90 segundos). La lista se
          recargará al terminar.
        </p>
      ) : null}

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
            <FiltersBuilder
              trigger={
                <Button variant="ghost" size="sm">
                  <ListFilterPlusIcon aria-hidden="true" />
                  Añadir filtro
                </Button>
              }
            />
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
                <div className="flex items-center gap-2">
                  <Skeleton className="h-1 w-24 rounded-full" />
                  <Skeleton className="h-3.5 w-8" />
                </div>
              </div>
              <Skeleton className="ml-auto size-2.5 shrink-0 rounded-full" />
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
            <Button size="sm" variant="ghost" onClick={reload}>
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
            <EmptyTitle>
              {distribuidorName
                ? "Sin clientes asignados"
                : "El panel no devolvió clientes"}
            </EmptyTitle>
            <EmptyDescription>
              {distribuidorName
                ? `No hay clientes asignados al distribuidor '${distribuidorName}'. Sincroniza con el panel por si el listado está desactualizado.`
                : "Sincroniza con el panel: hace login y extrae el listado actualizado de clientes."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="ghost" onClick={() => setSyncOpen(true)}>
              Sincronizar
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
              <div className="relative">
                <AccordionTrigger className="items-center gap-3 rounded-lg px-1.5 py-2.5 hover:bg-muted hover:no-underline focus-visible:border-transparent focus-visible:ring-0 dark:hover:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden">
                  <Avatar className="size-12">
                    <AvatarFallback>{initials(client.userName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-14">
                    <span className="truncate text-base font-semibold tracking-tight">
                      {client.userName}
                    </span>
                    {client.expiresAt || client.daysRemaining !== null ? (
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-muted-foreground truncate text-xs">
                          vence {formatFlujoDate(client.expiresAt)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={expiryProgress(client.daysRemaining)}
                            aria-label={`Días restantes de ${client.userName}`}
                            className={`w-24 max-w-full shrink-0 ${expiryProgressClass(client.daysRemaining)}`}
                          />
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {formatDaysCompact(client.daysRemaining)}
                          </span>
                        </div>
                      </div>
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
                </AccordionTrigger>
                <div className="pointer-events-none absolute inset-y-0 right-8 z-10 flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    onClick={() => openPurchase(client)}
                    disabled={purchasing}
                    aria-label={`Comprar 1 mes para ${client.userName}`}
                    className="pointer-events-auto size-11 shrink-0 rounded-full text-black transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 active:bg-primary/15 active:text-primary motion-reduce:active:scale-100 [&_svg]:size-7"
                  >
                    <ShoppingCartPlusIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
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

      <AlertDialog open={syncOpen} onOpenChange={setSyncOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Sincronizar los clientes con el panel?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Recargar hará login en el panel de FlujoTV y extraerá los datos
              actualizados de los clientes. La sincronización real tarda
              alrededor de 90 segundos; hasta que termine se siguen mostrando
              los datos actuales.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void runSync()
              }}
              disabled={syncing}
            >
              Sincronizar ahora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          if (!open && !purchasing) setPurchaseOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <ShoppingCartPlusIcon aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>¿Confirmar la compra?</AlertDialogTitle>
            <AlertDialogDescription>
              Compra automática de renovación en el panel de FlujoTV. La
              operación queda registrada y no se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {purchaseTarget ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Usuario</dt>
              <dd className="truncate font-medium">
                {purchaseTarget.userName}
              </dd>
              <dt className="text-muted-foreground">Renovación</dt>
              <dd className="font-medium">1 mes</dd>
              <dt className="text-muted-foreground">Vigencia actual</dt>
              <dd className="font-medium">
                {purchaseTarget.expiresAt
                  ? formatFlujoDate(purchaseTarget.expiresAt)
                  : "—"}
              </dd>
            </dl>
          ) : null}
          {purchaseError ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>La compra no se completó</AlertTitle>
              <AlertDescription>
                <p>{purchaseError}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purchasing}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void submitPurchase()
              }}
              disabled={purchasing}
            >
              {purchasing ? "Procesando…" : "Confirmar compra"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
