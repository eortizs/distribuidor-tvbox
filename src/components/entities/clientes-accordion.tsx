"use client"

/**
 * Pantalla Clientes (`/clientes`): listado de clientes del panel de FlujoTV
 * compuesto sobre el ejemplo `c-accordion-9` de ReUI (Frame + Accordion),
 * con filas tipo WhatsApp para lectura cómoda en móvil:
 *
 * - Fila: avatar grande con iniciales (`size-12`); como subtítulo del
 *   nombre de usuario, el nombre propio del cliente según la columna Notas
 *   del panel (mapa usuario → nombre de `/client_names`; si el panel no
 *   reporta nombre no se muestra nada) y, debajo, la barra de progreso
 *   (`ui/progress`) con el conteo compacto
 *   de días restantes a su derecha ("32d"). Al margen derecho, punto de
 *   estado (verde activo, rojo vencido, ámbar pendiente, azul prueba; tokens
 *   semánticos). La barra recorre
 *   los días restantes en una ventana de urgencia de 30 días — llena con
 *   más de 30 días y agotándose al acercarse el vencimiento (rojo ≤5 días
 *   o dato desconocido, ámbar ≤15, primario el resto).
 * - Sin chevron de expansión ni anillo de foco en el trigger: la fila es el
 *   botón; el detalle vive en el contenido expandido. Sin borde inferior
 *   entre filas (`not-last:border-b-0`): el ritmo lo dan el espaciado y el
 *   fondo al pasar el cursor.
 * - Contenido expandido: fecha de vencimiento ("vence 27 nov 2026").
 *
 * Cada fila lleva además el botón de **compra rápida** (shopping-cart-plus
 * de lucide), colocado entre el contenido y el punto de estado:
 *
 * - Posición: capa absoluta sobre la fila (`inset-y-0`, centrada en
 *   vertical con flex) a la izquierda del semáforo; la capa es
 *   `pointer-events-none` y solo el botón recibe toques, así el resto de la
 *   fila sigue alternando el acordeón. El botón es hermano del trigger y no
 *   descendiente: un `<button>` anidado rompería el HTML y la hidratación.
 * - Tamaño móvil: contenedor táctil de 36×36 px (`Button ghost size="icon"`
 *   con `h-9 w-9 rounded-full`) e icono de 20 px (`size-5` en el propio svg:
 *   la base del Button fija `size-4` para svg sin clase, y esa regla gana a
 *   un `[&_svg]` del consumidor) en negro puro en claro y blanco puro en
 *   oscuro (`text-black dark:text-white`).
 * - Feedback de pulsación: escala a 90 % con fondo `primary/15` e icono
 *   `primary` (curva de la casa, 200 ms); con `motion-reduce` se conserva
 *   solo el cambio de color.
 * - Flujo de pago: al pulsar abre un AlertDialog de confirmación con el
 *   resumen de la operación (usuario, renovación de 1 mes, importe en MXN).
 *   Confirmar llama `POST /api/mercadopago/orders`, que crea la orden
 *   `pending` y la preferencia de Mercado Pago (`purpose: wallet_purchase`:
 *   solo pagan cuentas de Mercado Pago, wallet a wallet), y redirige al
 *   `init_point` del checkout. La renovación NO ocurre aquí: el webhook
 *   `POST /api/mercadopago/webhook` verifica el pago contra la API de MP
 *   (monto, moneda, external_reference) y recién entonces renueva la licencia
 *   en el panel FlujoTV. El diálogo no se cierra mientras procesa (Escape
 *   ignorado) y los fallos avisan con toast además del Alert dentro del
 *   diálogo.
 * - Al volver de Mercado Pago (back_urls a `/clientes?orden=…&estado=…`) el
 *   componente muestra un Alert con el resultado y sondea
 *   `GET /api/mercadopago/orders/{id}` cada 2 s: al ver la orden `renewed`
 *   refresca la fila con una lectura en vivo del cliente
 *   (`GET /api/flujotv/clients/{usuario}` → `/find_user`, sin caché) en vez
 *   de recargar el listado: el listado viene del snapshot cacheado del panel
 *   y no reflejaría la renovación, y presentar vencimiento viejo como fresco
 *   invitaría a comprar dos veces. El cobro con renovación fallida
 *   (`renewal_failed`) avisa para que el admin la reintente;
 *   `rejected`/`cancelled` informa que no hubo cargo.
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
 * Antes de los chips, la barra abre con **vistas preconfiguradas**
 * (ToggleGroup outline, radio fijo), cada una con su contador: «Todos» —
 * limpia también los filtros manuales —, «Por vencer» (regla fija hardcoded
 * de menos de 3 días solo sobre clientes vigentes), «Activo» y «Inactivo»
 * (parten el listado por el estado del semáforo: inactivo = todo lo que no
 * está activo). Las reglas fijas viven fuera de la consulta editable para
 * que el operador no pueda desconfigurarlas. La vista activa se pinta con
 * el foreground del tema (negro en claro, blanco en oscuro). Las vistas y el
 * botón «Añadir filtro» — un círculo «+» con el mismo fondo del tema — van en
 * el renglón superior, desplazable en horizontal con el scrollbar oculto.
 * El picker abre con el título «Crear filtro», sin buscador de atributos, y
 * lista los campos como «por estado», «por distribuidor» y «por días para
 * vencer» (las etiquetas leen el chip como una frase). Los chips se
 * redondean a cápsula y la búsqueda lleva icono de lupa (InputGroup con
 * addon inicial).
 *
 * Los **filtros creados** bajan a su propio renglón, debajo de las vistas:
 * cada chip viaja con su contador en un paquete indivisible y el contenedor
 * envuelve (`flex-wrap`), de modo que al no caber el filtro salta al renglón
 * siguiente y la pila crece hacia abajo — siempre legible, sin escaparse en
 * el scroll horizontal. El renglón solo existe mientras haya filtros.
 *
 * Los filtros creados son **persistentes**: cada cambio de consulta se
 * guarda en localStorage (`clientes.filtros.v1`) y al recargar la página se
 * restaura el árbol guardado — se validan la forma y los campos (una regla
 * de un campo que ya no existe en la barra se suelta) y los ids se
 * reasignan para no chocar con la fábrica de ids del nuevo montaje. Borrar
 * los filtros («Todos» o la papelera del chip) también se guarda.
 *
 * El dato viene de `GET /api/flujotv/clients`, el mismo endpoint de la
 * pestaña Clientes del Lab; la búsqueda filtra en cliente por usuario,
 * nombre propio (sin acentos) o correo.
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
import { useRouter } from "next/navigation"
import {
  CircleCheckIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
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
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { Filters } from "@/components/reui/filters/filters"
import { FilterChip } from "@/components/reui/filters/filters-chip"
import { FiltersBuilder } from "@/components/reui/filters/filters-builder"
import {
  clearFilterQuery,
  createFilterQuery,
  flattenFilterRules,
  isFilterRuleComplete,
} from "@/components/reui/filters/filters-query"
import type {
  FilterField,
  FilterNode,
  FilterOption,
  FilterQuery,
} from "@/components/reui/filters/filters-types"
import type { FilterOperatorLabels } from "@/components/reui/filters/filters-operators"
import { formatMxn } from "@/lib/finanzas"
import {
  formatFlujoDate,
  type FlujoClient,
} from "@/lib/flujotv"

import {
  fetchFlujoClient,
  fetchFlujoClients,
  fetchFlujoResellers,
  refreshFlujo,
} from "@/components/lab/flujo-api"
import { createPaymentOrder, fetchPaymentOrder, type PaymentOrder } from "./pago-api"
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

/**
 * Ventana del filtro preconfigurado «Por vencer»: hardcoded, menos de 3 días.
 * Como toda regla sobre días, solo considera clientes vigentes (nunca vencidos).
 */
const POR_VENCER_DAYS = 3

/** Vistas preconfiguradas de la barra de filtros. */
type ClientPreset = "todos" | "por-vencer" | "activo" | "inactivo"

/** Vistas en orden de la barra; el orden define la prioridad del radio fijo. */
const PRESET_ITEMS: { value: ClientPreset; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "por-vencer", label: "Por vencer" },
  { value: "activo", label: "Activo" },
  { value: "inactivo", label: "Vencido" },
]

/**
 * ¿El cliente entra en la vista preconfigurada? Reglas fijas, fuera de la
 * consulta editable: «Por vencer» es hardcoded (<3 días, solo vigentes, como
 * toda regla de días) y «Activo»/«Vencido» parten el listado por el estado
 * del semáforo (la vista «Vencido» es todo lo que no está activo).
 */
function matchesPreset(client: FlujoClient, preset: ClientPreset): boolean {
  switch (preset) {
    case "todos":
      return true
    case "por-vencer":
      return (
        client.statusLabel !== "vencido" &&
        client.daysRemaining !== null &&
        client.daysRemaining < POR_VENCER_DAYS
      )
    case "activo":
      return client.statusLabel === "activo"
    case "inactivo":
      return client.statusLabel !== "activo"
  }
}

/**
 * Vista activa: fondo del color de primer plano del tema (negro en claro,
 * blanco en oscuro) con el texto en el color opuesto; el hover no la apaga.
 * Los botones de vista van en cápsula (`rounded-full`), igual que los chips,
 * para que ese fondo se lea circular.
 */
const PRESET_ACTIVE_CLASS =
  "aria-pressed:bg-foreground aria-pressed:text-background hover:aria-pressed:bg-foreground"

/** Contador dentro de una vista: se invierte sobre el fondo activo. */
const PRESET_COUNT_CLASS =
  "rounded-full tabular-nums group-aria-pressed/toggle:border-background/40 group-aria-pressed/toggle:bg-transparent dark:group-aria-pressed/toggle:border-background/40 dark:group-aria-pressed/toggle:bg-transparent"

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

/**
 * Nombre propio del cliente según la columna Notas del panel, del mapa que
 * entrega `/client_names` (usuario en minúsculas → nombre); vacío si el
 * panel no reporta nombre para ese usuario.
 */
function clientName(
  client: FlujoClient,
  names: Record<string, string>
): string {
  return names[client.userName.trim().toLowerCase()] ?? ""
}

/**
 * Normaliza para comparar textos: minúsculas y sin acentos, igual que la
 * búsqueda de `/client_names` («cambron» encuentra «Cambrón»).
 */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

/**
 * Clave de localStorage donde viven los filtros creados de `/clientes`: al
 * recargar la página se restauran tal y como quedaron (los valores son texto
 * y números JSON, así que el árbol viaja sin transformación).
 */
const FILTERS_STORAGE_KEY = "clientes.filtros.v1"

/**
 * Reconstruye un nodo guardado: valida la forma del árbol, descarta las
 * reglas cuyo campo ya no existe en la barra (p. ej. «por distribuidor» bajo
 * alcance de distribuidor) y reasigna ids frescos — la fábrica de ids de
 * `Filters` arranca en el mismo número en cada montaje, así que conservar los
 * ids guardados chocaría con el de la primera regla nueva. `null` = nodo
 * ilegible, se suelta.
 */
function reviveFilterNode(
  node: unknown,
  allowed: Set<string>,
  nextId: () => string
): FilterNode | null {
  if (!node || typeof node !== "object") return null
  const raw = node as {
    type?: unknown
    path?: unknown
    operator?: unknown
    value?: unknown
    negated?: unknown
    combinator?: unknown
    rules?: unknown
  }
  if (raw.type === "rule") {
    const path = Array.isArray(raw.path) ? raw.path.map(String) : []
    if (path.length === 0 || !allowed.has(path[0])) return null
    if (typeof raw.operator !== "string") return null
    return {
      id: nextId(),
      type: "rule",
      path,
      operator: raw.operator,
      value: raw.value,
      ...(raw.negated === true ? { negated: true } : {}),
    }
  }
  if (raw.type === "group") {
    const rules = Array.isArray(raw.rules)
      ? raw.rules
          .map((child) => reviveFilterNode(child, allowed, nextId))
          .filter((child): child is FilterNode => child !== null)
      : []
    return {
      id: nextId(),
      type: "group",
      combinator: raw.combinator === "or" ? "or" : "and",
      rules,
    }
  }
  return null
}

/**
 * Consulta almacenada → consulta viva. Devuelve null si no hay nada legible
 * o si no queda ninguna regla de un campo conocido: en ese caso se parte sin
 * filtros y el almacenamiento se actualiza con el siguiente cambio real.
 */
function reviveFilterQuery(
  stored: unknown,
  allowed: Set<string>
): FilterQuery | null {
  if (!stored || typeof stored !== "object") return null
  const root = stored as {
    type?: unknown
    combinator?: unknown
    rules?: unknown
  }
  if (root.type !== "group" || !Array.isArray(root.rules)) return null
  let seq = 0
  const nextId = () => `restored-${(seq += 1)}`
  const rules = root.rules
    .map((child) => reviveFilterNode(child, allowed, nextId))
    .filter((child): child is FilterNode => child !== null)
  return rules.length > 0
    ? createFilterQuery(rules, root.combinator === "or" ? "or" : "and")
    : null
}

/**
 * Aviso de retorno del checkout de Mercado Pago. El estado de display se
 * DERIVA: mientras hay orden de retorno sin resultado terminal, es
 * `working` (sondeo) o `rejected` si MP ya devolvió por el back_url de
 * fallo (definitivo, sin cargo). El sondeo solo fija `pollResult` desde
 * callbacks asíncronos cuando la orden alcanza un estado terminal.
 * - `renewed`: webhook aplicó la renovación; fila refrescada.
 * - `renewal_failed`: cobro confirmado, renovación fallida (reintento admin).
 * - `rejected`: pago rechazado/cancelado; sin cargo.
 * - `pending`: el sondeo expiró sin verificación; la renovación llegará igual.
 */
type PollStatus =
  | "renewed"
  | "renewal_failed"
  | "rejected"
  | "pending"

interface ClientesAccordionProps {
  /** Reseller ligado a la cuenta (perfil distribuidor); null = sin alcance. */
  distribuidorName?: string | null
  /** Precio MXN del mes de renovación (del .env del servidor); null = sin config. */
  priceMxn?: number | null
  /** Id de la orden de pago en el retorno del checkout (back_urls). */
  returnOrder?: string | null
  /** Estado declarado por el back_url: aprobado | rechazado | pendiente. */
  returnState?: string | null
}

export function ClientesAccordion({
  distribuidorName = null,
  priceMxn = null,
  returnOrder = null,
  returnState = null,
}: ClientesAccordionProps) {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [resellerNames, setResellerNames] = useState<string[]>([])
  const [userResellers, setUserResellers] = useState<Record<string, string>>({})
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [preset, setPreset] = useState<ClientPreset>("todos")
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [reloadCount, setReloadCount] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseTarget, setPurchaseTarget] = useState<FlujoClient | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [pollResult, setPollResult] = useState<{
    status: PollStatus
    order: PaymentOrder | null
  } | null>(null)

  const requestCounter = useRef(0)
  const router = useRouter()

  /**
   * Consulta con la que montó el componente: el efecto de persistencia la usa
   * para no escribir nada mientras el estado siga sin cambios — así la
   * restauración de abajo nunca pisa lo guardado con una consulta vacía.
   */
  const initialQueryRef = useRef(query)

  /**
   * Restauración de los filtros creados en la visita anterior: localStorage
   * sobrevive a la recarga, así que los chips reaparecen tal cual quedaron.
   * Los campos admitidos dependen del alcance (el distribuidor no ve el filtro
   * de Distribuidor); todo lo demás se suelta al restaurar. La lectura corre
   * en un microtask — el primer pintado no espera al almacenamiento y la
   * actualización no entra en cascada de forma sincrónica con el montaje — y
   * solo aplica si la consulta sigue siendo la del primer render.
   */
  useEffect(() => {
    void Promise.resolve().then(() => {
      let stored: unknown = null
      try {
        stored = JSON.parse(
          window.localStorage.getItem(FILTERS_STORAGE_KEY) ?? "null"
        ) as unknown
      } catch {
        return
      }
      const allowed = new Set(
        distribuidorName ? ["estado", "dias"] : ["estado", "reseller", "dias"]
      )
      const revived = reviveFilterQuery(stored, allowed)
      if (revived) {
        setQuery((current) =>
          current === initialQueryRef.current ? revived : current
        )
      }
    })
  }, [distribuidorName])

  /**
   * Persistencia de los filtros creados: cada cambio de consulta — chips
   * nuevos, edición de valores y también el limpiado de «Todos» — se guarda
   * para la próxima recarga. Mientras la consulta siga siendo la del primer
   * render no hay nada nuevo que escribir.
   */
  useEffect(() => {
    if (query === initialQueryRef.current) return
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(query))
    } catch {
      // Cuota agotada o almacenamiento bloqueado: la sesión sigue en memoria.
    }
  }, [query])

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
        setClientNames(data.clientNames ?? {})
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

  const openPurchase = useCallback((client: FlujoClient) => {
    setPurchaseTarget(client)
    setPurchaseError(null)
    setPurchaseOpen(true)
  }, [])

  const submitPurchase = useCallback(async () => {
    if (!purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    setPurchasing(true)
    setPurchaseError(null)
    try {
      const order = await createPaymentOrder({ userName, months: 1 })
      // Redirección completa al checkout de Mercado Pago (wallet_purchase):
      // el pago ocurre fuera del panel y el retorno lo maneja el aviso de
      // retorno; la renovación la aplica el webhook del servidor.
      window.location.assign(order.initPoint)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo iniciar el pago."
      setPurchaseError(message)
      setPurchasing(false)
    }
  }, [purchaseTarget])

  /** Refresca una fila con la lectura en vivo del cliente en el panel. */
  const refreshRow = useCallback((userName: string) => {
    fetchFlujoClient(userName)
      .then((fresh) => {
        if (fresh) {
          setClients((rows) =>
            rows.map((row) => (row.id === fresh.id ? fresh : row))
          )
        }
      })
      .catch(() => {})
  }, [])

  /**
   * Retorno del checkout (`?orden=…&estado=…`): sondea el estado de la orden
   * hasta verla `renewed` —la renovación la aplica el webhook, típicamente en
   * unos segundos— y refresca la fila con el dato vivo del panel. La llegada
   * por el back_url de fallo no se sondea: es definitiva y no hubo cargo
   * (el estado de display «rechazado» se deriva en el render, sin setState).
   * Al confirmarse la renovación se limpia la query (`router.replace`) para
   * que recargar la página no repita el sondeo.
   */
  useEffect(() => {
    if (!returnOrder || returnState === "rechazado") return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    // Última lectura de la orden: alimenta los avisos que muestran datos
    // (usuario, importe) incluso cuando el sondeo expira en «pendiente».
    let lastOrder: PaymentOrder | null = null

    const tick = async () => {
      attempts += 1
      let order: PaymentOrder | null = null
      try {
        order = await fetchPaymentOrder(returnOrder)
      } catch {
        order = null
      }
      if (cancelled) return

      if (order) {
        lastOrder = order
        if (order.status === "renewed") {
          setPollResult({ status: "renewed", order })
          toast.success("Renovación aplicada", {
            description: `${order.user_name} · ${order.months} ${
              order.months === 1 ? "mes" : "meses"
            } · ${formatMxn(order.amount)}`,
          })
          refreshRow(order.user_name)
          router.replace("/clientes")
          return
        }
        if (order.status === "renewal_failed") {
          setPollResult({ status: "renewal_failed", order })
          return
        }
        if (order.status === "rejected" || order.status === "cancelled") {
          setPollResult({ status: "rejected", order })
          return
        }
      }

      if (attempts >= 30) {
        // ~60 s de sondeo sin confirmación: el pago sigue en proceso o el
        // webhook está tardando; la conciliación del servidor lo recupera.
        setPollResult({ status: "pending", order: lastOrder })
        return
      }
      timer = setTimeout(() => {
        void tick()
      }, 2000)
    }

    timer = setTimeout(() => {
      void tick()
    }, 400)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [returnOrder, returnState, refreshRow, router])

  /**
   * Estado de display del aviso de retorno, derivado sin estado extra: el
   * resultado terminal del sondeo manda y DEBE sobrevivir a la limpieza de la
   * query (`router.replace` borra `returnOrder` pero el componente conserva
   * `pollResult`), o el aviso de éxito se desmontaría al instante. Sin
   * resultado terminal: «rechazado» si MP devolvió por el back_url de fallo,
   * «working» si se viene del checkout con sondeo activo, y nada sin orden
   * de retorno.
   */
  const returnStatus: "working" | PollStatus | null =
    pollResult?.status ??
    (!returnOrder
      ? null
      : returnState === "rechazado"
        ? "rejected"
        : "working")

  /** Facetas por opción, calculadas sobre el listado cargado. */
  const estadoCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const client of clients) {
      counts.set(client.statusLabel, (counts.get(client.statusLabel) ?? 0) + 1)
    }
    return counts
  }, [clients])

  /** Cuántos clientes entran en cada vista preconfigurada. */
  const presetCounts = useMemo(() => {
    const counts = {} as Record<ClientPreset, number>
    for (const item of PRESET_ITEMS) counts[item.value] = 0
    for (const client of clients) {
      for (const item of PRESET_ITEMS) {
        if (matchesPreset(client, item.value)) counts[item.value] += 1
      }
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
        label: "por estado",
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
        label: "por distribuidor",
        type: "select",
        options: resellerOptions,
      })
    }
    fields.push({
      id: "dias",
      label: "por días para vencer",
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
    // Vista preconfigurada: regla fija FUERA de la consulta editable, para
    // que el operador no pueda desconfigurarla; «Por vencer» excluye vencidos.
    const withPreset =
      preset === "todos"
        ? eligible
        : eligible.filter((client) => matchesPreset(client, preset))
    const byQuery = applyFilterQuery(withPreset, query, {
      estado: (row) => row.statusLabel,
      reseller: resellerOf,
      dias: (row) => row.daysRemaining,
    })
    const term = foldTerm(searchInput)
    if (!term) return byQuery
    return byQuery.filter(
      (client) =>
        foldTerm(client.userName).includes(term) ||
        foldTerm(client.email ?? "").includes(term) ||
        foldTerm(clientName(client, clientNames)).includes(term)
    )
  }, [clients, preset, query, searchInput, resellerOf, clientNames])

  const searching = searchInput.trim().length > 0
  const hasFilters = query.rules.length > 0 || preset !== "todos"
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
        <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
          <InputGroupAddon align="inline-start" className="pl-3.5">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar cliente por usuario, nombre o correo"
            className="h-full text-base"
          />
          {/*
           * Botón de limpieza (X) del buscador: visible solo con texto
           * (`searching`). En móvil el área táctil es de 36px redonda y el
           * addon anula el margen negativo del patrón (`mr-0 pr-2.5`) para
           * que la X respire y no quede pegada al borde derecho del pill.
           */}
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

      {/*
       * Aviso de retorno del checkout de Mercado Pago (back_urls). El estado
       * real vive en la orden y lo confirma el webhook; el sondeo refresca la
       * fila al ver `renewed` y limpia la query para no repetir el sondeo.
       */}
      {returnStatus === "working" ? (
        <Alert variant="info">
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          <AlertTitle>Pago en verificación</AlertTitle>
          <AlertDescription>
            <p>
              Estamos confirmando el pago con Mercado Pago y aplicando la
              renovación; la fila se actualizará en unos segundos. Puedes
              cerrar esta página sin riesgo: el cobro ya quedó registrado.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "renewed" ? (
        <Alert variant="success">
          <CircleCheckIcon aria-hidden="true" />
          <AlertTitle>Renovación aplicada</AlertTitle>
          <AlertDescription>
            <p>
              {pollResult?.order
                ? `${pollResult.order.user_name} · ${pollResult.order.months} ${
                    pollResult.order.months === 1 ? "mes" : "meses"
                  } · ${formatMxn(pollResult.order.amount)}`
                : "La licencia quedó renovada y la fila ya muestra el vencimiento nuevo."}
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "renewal_failed" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>El pago llegó pero la renovación falló</AlertTitle>
          <AlertDescription>
            <p>
              {pollResult?.order
                ? `Mercado Pago confirmó ${formatMxn(pollResult.order.amount)} para ${pollResult.order.user_name}, `
                : ""}
              pero la renovación no se pudo aplicar en el panel. Avisa al
              administrador para que la reintente
              {returnOrder ? ` con la orden ${returnOrder}` : ""}.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "rejected" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>El pago no se completó</AlertTitle>
          <AlertDescription>
            <p>
              Mercado Pago rechazó o canceló el pago, así que no se hizo
              ningún cargo ni renovación. Puedes intentarlo de nuevo con el
              botón de compra.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "pending" ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>La renovación sigue en proceso</AlertTitle>
          <AlertDescription>
            <p>
              El pago quedó registrado; la renovación se aplicará en cuanto
              Mercado Pago lo confirme. Recarga en un momento para ver la fila
              actualizada.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

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
          <div className="flex flex-col gap-2">
            {/*
             * Renglón 1: las vistas preconfiguradas y el botón «Añadir
             * filtro», en una sola fila desplazable en horizontal con el
             * scrollbar oculto. El «+» se queda arriba: los filtros que crea
             * bajan al renglón de abajo.
             */}
            <div
              role="toolbar"
              aria-label={LAB_FILTER_LABELS.filtersLabel}
              className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
            >
              <ToggleGroup
                variant="outline"
                size="sm"
                value={[preset]}
                onValueChange={(groupValue) => {
                  // Radio fijo: volver a pulsar la vista activa no la suelta.
                  // «Todos» además limpia los filtros manuales: la vista muestra
                  // el listado completo sin condiciones.
                  const next =
                    PRESET_ITEMS.find((item) =>
                      groupValue.includes(item.value)
                    )?.value ?? preset
                  setPreset(next)
                  if (next === "todos") {
                    setQuery((current) => clearFilterQuery(current))
                  }
                }}
                aria-label="Vistas preconfiguradas de clientes"
              >
                {PRESET_ITEMS.map((item) => (
                  <ToggleGroupItem
                    key={item.value}
                    value={item.value}
                    className={`rounded-full ${PRESET_ACTIVE_CLASS}`}
                  >
                    {item.label}
                    <Badge variant="outline" size="xs" className={PRESET_COUNT_CLASS}>
                      {presetCounts[item.value]}
                    </Badge>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FiltersBuilder
                /* El picker abre como una vista de «Crear filtro»: sin buscador
                   de atributos (la fila de búsqueda se oculta desde el
                   consumidor) y con el título impreso sobre la lista. */
                className="before:text-foreground before:font-medium before:tracking-tight before:block before:content-['Crear_filtro'] before:px-3 before:pb-1 before:pt-2.5 [&_[data-slot=cascader-nav]]:hidden"
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Añadir filtro"
                    className="size-7 rounded-full bg-foreground p-0 text-background hover:bg-foreground/80 [&_svg:not([class*='size-'])]:size-4"
                  >
                    <PlusIcon aria-hidden="true" />
                  </Button>
                }
              />
            </div>
            {/*
             * Renglón 2: el stack de filtros creados. Cada chip viaja con su
             * contador en un paquete indivisible y el contenedor envuelve
             * (`flex-wrap`): al no caber, el filtro baja al renglón siguiente
             * y la pila crece hacia abajo, siempre legible en lugar de
             * escaparse en el scroll horizontal.
             */}
            {rules.length > 0 ? (
              <div
                role="group"
                aria-label="Filtros creados"
                className="flex flex-wrap items-center gap-2 [&_[data-slot=filter-chip]>[data-slot]:first-child]:rounded-l-full [&_[data-slot=filter-chip]>[data-slot]:last-child]:rounded-r-full!"
              >
                {rules.map((rule, index) => {
                  const count = ruleCounts.get(rule.id)
                  return (
                    <span
                      key={rule.id}
                      className="flex shrink-0 items-center gap-1.5"
                    >
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
                    </span>
                  )
                })}
              </div>
            ) : null}
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
              className="not-last:border-b-0 bg-transparent p-0"
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
                    {clientName(client, clientNames) ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {clientName(client, clientNames)}
                      </span>
                    ) : null}
                    {client.expiresAt || client.daysRemaining !== null ? (
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
                    size="icon"
                    onClick={() => openPurchase(client)}
                    disabled={purchasing}
                    aria-label={`Comprar 1 mes para ${client.userName}`}
                    className="pointer-events-auto h-9 w-9 shrink-0 rounded-full text-black dark:text-white transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 active:bg-primary/15 active:text-primary motion-reduce:active:scale-100"
                  >
                    <ShoppingCartPlusIcon
                      aria-hidden="true"
                      className="size-5"
                    />
                  </Button>
                </div>
              </div>
              <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
                <div className="flex flex-col gap-1 pb-1 text-xs">
                  <span className="truncate">
                    vence {formatFlujoDate(client.expiresAt)}
                  </span>
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
              Se abrirá el checkout de Mercado Pago para pagar con tu cuenta de
              Mercado Pago. La licencia se renueva automáticamente cuando se
              confirma el pago.
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
              <dt className="text-muted-foreground">Importe</dt>
              <dd className="font-medium">
                {priceMxn !== null ? formatMxn(priceMxn) : "No disponible"}
              </dd>
              <dt className="text-muted-foreground">Vigencia actual</dt>
              <dd className="font-medium">
                {purchaseTarget.expiresAt
                  ? formatFlujoDate(purchaseTarget.expiresAt)
                  : "—"}
              </dd>
            </dl>
          ) : null}
          {priceMxn === null ? (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Pago no configurado</AlertTitle>
              <AlertDescription>
                <p>
                  El servidor no tiene definido el precio de la licencia
                  (LICENSE_PRICE_MXN). No se puede iniciar el pago.
                </p>
              </AlertDescription>
            </Alert>
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
              disabled={purchasing || priceMxn === null}
            >
              {purchasing ? "Abriendo checkout…" : "Pagar con Mercado Pago"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
