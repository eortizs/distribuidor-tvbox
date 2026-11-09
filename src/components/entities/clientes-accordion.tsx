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
 * - Flujo de pago: al pulsar abre un **bottom sheet** (Drawer de Base UI,
 *   anclado al borde inferior con `swipeDirection="down"` y asa de arrastre
 *   `showSwipeHandle`, patrón móvil moderno) con el resumen compacto de la
 *   operación (usuario, renovación de 1 mes, importe en MXN a la derecha en
 *   grande) y un **selector de método de pago** (RadioGroup en filas-tarjeta,
 *   una línea de descripción por método):
 *
 *   - **Mercado Pago**: la acción primaria «Pagar con Mercado Pago» llama
 *     `POST /api/mercadopago/orders`, que crea la orden `pending` y la
 *     preferencia de Mercado Pago (`purpose: wallet_purchase`: solo pagan
 *     cuentas de Mercado Pago, wallet a wallet), y redirige al `init_point`
 *     del checkout. La renovación NO ocurre aquí: el webhook
 *     `POST /api/mercadopago/webhook` verifica el pago contra la API de MP
 *     (monto, moneda, external_reference) y recién entonces renueva la
 *     licencia en el panel FlujoTV.
 *   - **Transferencia bancaria**: muestra los datos bancarios del servidor
 *     (banco, titular y cuenta con botón de copiar; env `TRANSFER_*`) y la
 *     subida del ticket (foto o PDF, `useFileUpload`); «Enviar comprobante»
 *     crea la orden con el ticket vía `POST /api/transferencias/orders` y el
 *     servidor lo verifica con el LLM (`RECEIPT_SCAN_MODEL`): fecha dentro
 *     del mes actual, concepto con el usuario de FlujoTV, importe de la
 *     orden y beneficiario receptor (tolerante). Al enviar, la app se
 *     BLOQUEA con un overlay por etapas hasta el 100% del proceso: 1)
 *     validación del comprobante, 2) renovación en el panel de FlujoTV
 *     (sondeo de la orden cada 3 s; la lectura además concilia órdenes
 *     varadas) y 3) resultado final — exitosa con vencimiento verificado o
 *     fallida con aviso de contactar al admin. Solo el panel final libera la
 *     app; el bloqueo se restaura desde localStorage si el usuario recarga o
 *     vuelve más tarde, mostrando el resultado aunque el proceso haya
 *     terminado fuera de la pestaña. Comprobante no autorizado o revisión
 *     manual (sin escaneo configurado, cupón agotado, escaneo caído)
 *     liberan al instante: el sheet muestra los motivos y la orden queda
 *     `pending` para la revisión del admin (`TransferenciasReview`, sección
 *     solo admin sobre el listado). El evento en tiempo real `mp_order`
 *     refresca solo la fila del usuario renovado (el evento viaja con el
 *     usuario y el estado nuevo): sin recargar el listado completo, que es
 *     lento y traería el snapshot cacheado con el vencimiento viejo.
 *   - **Cupón**: código de 4 dígitos con InputOTP (ejemplo `c-input-otp-2`
 *     de ReUI); «Aplicar cupón» llama `POST /api/cupones/orders`, que valida
 *     el código contra los cupones activos (por ahora solo `0000`, compra
 *     directa sin validaciones) y renueva la licencia al instante. El código
 *     queda en la orden (`coupon_code`) para la futura conciliación con el
 *     catálogo de cupones autorizados.
 *
 *   El sheet no se cierra mientras procesa (Escape y swipe bloqueados) y los
 *   fallos avisan con toast además del Alert dentro del sheet.
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
import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  CheckIcon,
  CircleCheckIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TicketPercentIcon,
  UploadIcon,
  WalletIcon,
  XIcon,
  ShoppingCartPlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import type { RealtimeMessage } from "@/components/realtime/realtime-provider"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
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
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { Filters } from "@/components/reui/filters/filters"
import { FilterChip } from "@/components/reui/filters/filters-chip"
import { FiltersBuilder } from "@/components/reui/filters/filters-builder"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"
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
import {
  createPaymentOrder,
  createCouponOrder,
  createTransferOrder,
  fetchPaymentOrder,
  retryOrderRenewal,
  PagoRequestError,
  type PaymentOrder,
} from "./pago-api"
import { TransferenciasReview } from "./transferencias-review"
import { RefundsReview } from "./refunds-review"
import {
  applyFilterQuery,
  matchesFilterRule,
} from "@/components/lab/filter-utils"
import { LAB_FILTER_LABELS } from "@/components/lab/lab-i18n"

type FetchState = "loading" | "success" | "error"

/** Métodos de pago del bottom sheet de renovación. */
type PayMethod = "mercadopago" | "transferencia" | "cupon"

/** Tamaño máximo del ticket de transferencia (igual que el servidor). */
const TICKET_MAX_BYTES = 10 * 1024 * 1024

/** Longitud del código de cupón. */
const COUPON_CODE_LENGTH = 4

/**
 * Bloqueo de renovación por transferencia: la renovación depende del panel
 * de FlujoTV y puede tardar varios minutos, así que la app queda bloqueada
 * con el estado por etapa (validación → renovación → resultado) hasta que el
 * proceso termina al 100%; solo entonces se libera. La orden en curso se
 * recuerda en localStorage para restaurar el bloqueo si el usuario recarga
 * o vuelve más tarde: el sondeo muestra el resultado final aunque el proceso
 * haya terminado con la pestaña cerrada.
 */
const RENEWAL_STORAGE_KEY = "clientes.renovacion.v1"

/** Etapas visibles del bloqueo. */
type RenewalStage = "validando" | "renovando" | "exito" | "fallo"

interface RenewalBlock {
  orderId: string
  userName: string
  stage: RenewalStage
  /** Vencimiento nuevo verificado (solo etapa exito). */
  verifiedExpiresAt: string | null
  /** Momento de inicio (ms) para el aviso de demora. */
  startedAt: number
}

/**
 * Aviso de demora: si la renovación (etapa renovando) supera esto, la UI
 * aclara que sigue activa pero tardando más de lo normal. Nunca libera: el
 * servidor concilia órdenes varadas al sondearlas y terminará en un estado
 * final (renewed / renewal_failed).
 */
const RENEWAL_SLOW_AFTER_MS = 90_000

function persistRenewalBlock(block: RenewalBlock): void {
  try {
    window.localStorage.setItem(
      RENEWAL_STORAGE_KEY,
      JSON.stringify({
        orderId: block.orderId,
        userName: block.userName,
        startedAt: block.startedAt,
      })
    )
  } catch {
    // Cuota agotada o almacenamiento bloqueado: el bloqueo vive en memoria.
  }
}

function clearRenewalStorage(): void {
  try {
    window.localStorage.removeItem(RENEWAL_STORAGE_KEY)
  } catch {
    // Sin almacenamiento: nada que limpiar.
  }
}

/**
 * Segmento de confirmación con el vencimiento nuevo verificado en el panel:
 * la evidencia de que la renovación aplicó de verdad (null = sin lectura
 * verificada, p. ej. órdenes renovadas antes de la verificación).
 */
function verifiedExpiresSuffix(expiresAt: string | null): string {
  return expiresAt ? ` · nuevo vencimiento: ${formatFlujoDate(expiresAt)}` : ""
}

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
  /** Datos bancarios para pagar por transferencia; null = método oculto. */
  transferBank?: {
    bank: string
    account: string
    holder: string
  } | null
  /**
   * Cupón de QA activado en el servidor (`COUPON_QA_ENABLED=1`); false =
   * la opción de cupón se oculta en lugar de ofrecer un canje rechazado.
   */
  couponEnabled?: boolean
  /** Perfil admin: muestra la sección de transferencias por revisar. */
  canReviewTransfers?: boolean
}

export function ClientesAccordion({
  distribuidorName = null,
  priceMxn = null,
  returnOrder = null,
  returnState = null,
  transferBank = null,
  couponEnabled = false,
  canReviewTransfers = false,
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
  const [payError, setPayError] = useState<string | null>(null)
  /** Método elegido en el sheet: Mercado Pago por defecto. */
  const [payMethod, setPayMethod] = useState<PayMethod>("mercadopago")
  const [submittingTransfer, setSubmittingTransfer] = useState(false)
  /**
   * Resultado de la verificación automática del comprobante: con
   * `auto_rejected` el sheet permanece abierto con los motivos y el aviso de
   * contactar al administrador (la orden quedó `pending` para su revisión
   * manual y el comprador puede subir otro comprobante).
   */
  const [transferRejected, setTransferRejected] = useState<{
    reasons: string[]
  } | null>(null)
  /**
   * Bloqueo de la app durante la renovación por transferencia: cubre la
   * validación del comprobante, la renovación en el panel y el resultado
   * final (exito/fallo); solo el botón del panel final libera la app.
   */
  const [renewalBlock, setRenewalBlock] = useState<RenewalBlock | null>(null)
  /** Reloj para el aviso de demora dentro del bloqueo (5 s). */
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [submittingCoupon, setSubmittingCoupon] = useState(false)
  const [couponCode, setCouponCode] = useState("")
  /**
   * Orden con renovación fallida pendiente de recuperación en este canje: el
   * botón principal pasa de «Aplicar cupón» a «Reintentar renovación» (sin
   * nuevo canje ni nuevo cargo; la clave determinista evita duplicar meses).
   */
  const [couponRetryOrderId, setCouponRetryOrderId] = useState<string | null>(
    null
  )
  /**
   * Id de la intención de canje vigente: se regenera al abrir el sheet y se
   * conserva entre reintentos del mismo intento, de modo que un reintento
   * tras una respuesta perdida devuelve la orden original (idempotente en el
   * servidor) en lugar de sumar otro mes.
   */
  const couponRequestIdRef = useRef<string>("")
  const [accountCopied, setAccountCopied] = useState(false)
  const [pollResult, setPollResult] = useState<{
    status: PollStatus
    order: PaymentOrder | null
  } | null>(null)

  /**
   * Ticket de la transferencia: un solo archivo (foto o PDF del comprobante),
   * validado en cliente como en el servidor (tipo y tamaño) para fallar rápido.
   */
  const [ticketFiles, ticketActions] = useFileUpload({
    accept: "image/*,application/pdf",
    multiple: false,
    maxSize: TICKET_MAX_BYTES,
  })

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

  /**
   * Restauración del bloqueo de renovación: si la pestaña se recargó o se
   * cerró con una renovación en curso, el bloqueo reaparece y el sondeo
   * lleva la orden a su estado final — el usuario ve el resultado aunque el
   * proceso haya terminado fuera de la pestaña. La lectura corre en un
   * microtask (mismo patrón que la restauración de filtros): el primer
   * pintado no espera al almacenamiento.
   */
  useEffect(() => {
    void Promise.resolve().then(() => {
      let raw: string | null = null
      try {
        raw = window.localStorage.getItem(RENEWAL_STORAGE_KEY)
      } catch {
        return
      }
      if (!raw) return
      let saved: {
        orderId?: unknown
        userName?: unknown
        startedAt?: unknown
      }
      try {
        saved = JSON.parse(raw) as typeof saved
      } catch {
        return
      }
      if (
        typeof saved.orderId !== "string" ||
        typeof saved.userName !== "string"
      ) {
        return
      }
      setRenewalBlock({
        orderId: saved.orderId,
        userName: saved.userName,
        stage: "renovando",
        verifiedExpiresAt: null,
        startedAt:
          typeof saved.startedAt === "number" ? saved.startedAt : Date.now(),
      })
    })
  }, [])

  /** Reloj del aviso de demora, activo solo mientras la app está bloqueada. */
  useEffect(() => {
    if (!renewalBlock) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [renewalBlock])
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

  const openPurchase = useCallback(
    (client: FlujoClient) => {
      setPurchaseTarget(client)
      setPayMethod("mercadopago")
      setPayError(null)
      setTransferRejected(null)
      setCouponCode("")
      setCouponRetryOrderId(null)
      couponRequestIdRef.current =
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      ticketActions.clearFiles()
      setPurchaseOpen(true)
    },
    [ticketActions]
  )

  const submitPurchase = useCallback(async () => {
    if (!purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    setPurchasing(true)
    setPayError(null)
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
      setPayError(message)
      setPurchasing(false)
    }
  }, [purchaseTarget])

  /**
   * Envía la renovación por transferencia bancaria y BLOQUEA la app hasta el
   * 100% del proceso: etapa 1 validación del comprobante (durante la
   * petición), etapa 2 renovación en el panel (sondeo de la orden cada 3 s)
   * y etapa 3 resultado final (exito con vencimiento verificado / fallo con
   * aviso de contactar al admin). Solo el panel final libera la app. Un
   * comprobante no autorizado o una revisión manual liberan al instante
   * (sheet con el veredicto / flujo legacy de revisión admin).
   */
  const submitTransfer = useCallback(async () => {
    if (!purchaseTarget) return
    const ticket = ticketFiles.files[0]?.file
    if (!(ticket instanceof File)) return
    const userName = purchaseTarget.userName.trim()
    setSubmittingTransfer(true)
    setPayError(null)
    setTransferRejected(null)
    // Etapa 1: la app queda bloqueada mientras el servidor valida.
    setRenewalBlock({
      orderId: "",
      userName,
      stage: "validando",
      verifiedExpiresAt: null,
      startedAt: Date.now(),
    })
    try {
      const result = await createTransferOrder({ userName, months: 1, file: ticket })
      if (result.review === "auto_approved") {
        // Etapa 2: renovación en el panel; el sondeo del bloqueo lleva la
        // orden hasta su estado final antes de liberar.
        const block: RenewalBlock = {
          orderId: result.orderId,
          userName,
          stage: "renovando",
          verifiedExpiresAt: null,
          startedAt: Date.now(),
        }
        setRenewalBlock(block)
        persistRenewalBlock(block)
      } else if (result.review === "auto_rejected") {
        // Se suelta el archivo rechazado: reenviar el mismo comprobante da
        // el mismo veredicto y cada envío crea otra orden pendiente (riesgo
        // de duplicados que el admin apruebe dos veces).
        clearRenewalStorage()
        setRenewalBlock(null)
        ticketActions.clearFiles()
        setTransferRejected({ reasons: result.reasons ?? [] })
        toast.error("Comprobante no autorizado", {
          description:
            "Contacta al administrador para una revisión manual de tu pago.",
        })
      } else {
        // Revisión manual (sin escaneo configurado, cupón agotado o error
        // del escaneo): el veredicto no llega solo, así que la app se
        // libera con el aviso del flujo legacy.
        clearRenewalStorage()
        setRenewalBlock(null)
        ticketActions.clearFiles()
        setPurchaseOpen(false)
        toast.success("Comprobante enviado", {
          description: `La renovación de ${userName} se aplicará en cuanto se confirme el pago.`,
        })
      }
    } catch (error) {
      clearRenewalStorage()
      setRenewalBlock(null)
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el comprobante."
      )
    } finally {
      setSubmittingTransfer(false)
    }
  }, [purchaseTarget, ticketActions, ticketFiles])

  /** Copia la cuenta bancaria al portapapeles con feedback breve. */
  const copyAccount = useCallback(() => {
    if (!transferBank) return
    navigator.clipboard
      .writeText(transferBank.account)
      .then(() => {
        setAccountCopied(true)
        window.setTimeout(() => setAccountCopied(false), 2000)
      })
      .catch(() => {
        toast.error("No se pudo copiar la cuenta.")
      })
  }, [transferBank])

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
   * Tiempo real: los cambios de entidades hechos en otro dispositivo
   * refrescan el listado en silencio, sin el spinner de recarga manual.
   *
   * Las órdenes de Mercado Pago NO recargan el listado: recargarlo es lento
   * y, peor, el listado viene del snapshot cacheado del panel — presentaría
   * el vencimiento VIEJO pisando la fecha nueva que la fila ya mostraba. La
   * fila de un cliente solo cambia cuando la renovación se APLICÓ
   * (`renewed`), y ese evento viaja con el usuario renovado: se refresca
   * SOLO su fila con la lectura en vivo del panel (el mismo mecanismo de
   * `refreshRow` que usan los flujos de compra de esta pestaña), dejando el
   * resto del listado intacto. Eventos sin renovación aplicada (`pending`,
   * `paid` en curso, rechazos, reembolsos, escaneo de comprobante) no
   * mueven el vencimiento de nadie: no tocan filas.
   */
  useRealtimeEvent(
    ["entity", "mp_order"],
    useCallback(
      (message: RealtimeMessage) => {
        if (message.kind === "mp_order") {
          if (message.status === "renewed" && message.userName) {
            refreshRow(message.userName)
          }
          return
        }
        setReloadCount((token) => token + 1)
      },
      [refreshRow]
    )
  )

  /**
   * Sondeo del bloqueo: mientras la renovación corre (etapa renovando),
   * consulta la orden cada 3 s. La lectura además concilia estados varados
   * en el servidor (pagado sin renovar se reintenta a los 10 min), así que
   * el sondeo siempre acaba en un estado final: renewed o renewal_failed.
   */
  useEffect(() => {
    if (renewalBlock?.stage !== "renovando" || !renewalBlock.orderId) return
    const block = renewalBlock
    let alive = true
    const tick = async () => {
      try {
        const order = await fetchPaymentOrder(block.orderId)
        if (!alive) return
        if (order.status === "renewed") {
          clearRenewalStorage()
          setRenewalBlock({
            ...block,
            stage: "exito",
            verifiedExpiresAt: order.renewal_verified_expires_at,
          })
          refreshRow(block.userName)
        } else if (order.status === "renewal_failed") {
          clearRenewalStorage()
          setRenewalBlock({ ...block, stage: "fallo" })
        }
        // Estados intermedios (pending/paid): se sigue sondeando.
      } catch {
        // Error puntual de red: el siguiente tick reintenta.
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [renewalBlock, refreshRow])

  /** Libera el bloqueo al terminar: cierra el sheet y limpia el estado. */
  const releaseRenewalBlock = useCallback(() => {
    clearRenewalStorage()
    setRenewalBlock(null)
    setPurchaseOpen(false)
    setTransferRejected(null)
    ticketActions.clearFiles()
  }, [ticketActions])

  /**
   * Canjea el cupón: el servidor valida el código contra los cupones activos
   * (0000 con `COUPON_QA_ENABLED`) y, si es válido, renueva la licencia al
   * instante. El canje es idempotente por `couponRequestIdRef`: un reintento
   * tras una respuesta perdida devuelve la orden original en lugar de sumar
   * otro mes.
   */
  const submitCoupon = useCallback(async () => {
    if (!purchaseTarget || couponCode.length !== COUPON_CODE_LENGTH) return
    const userName = purchaseTarget.userName.trim()
    const requestId = couponRequestIdRef.current
    if (requestId.length === 0) return
    setSubmittingCoupon(true)
    setPayError(null)
    try {
      const result = await createCouponOrder({
        userName,
        months: 1,
        code: couponCode,
        requestId,
      })
      if (result.status === "renewal_failed") {
        // El canje quedó registrado pero la renovación no se confirmó contra
        // el panel (vencimiento sin cambio o lectura imposible): el botón
        // principal pasa a reintentar la renovación (misma orden, sin nuevo
        // canje).
        setCouponRetryOrderId(result.orderId)
        setPayError(
          `El cupón se aceptó y quedó registrado (orden ${result.orderId.slice(0, 8)}…), pero la renovación no se confirmó en el panel de licencias.${result.error ? ` ${result.error}` : ""} Pulsa «Reintentar renovación»: no se vuelve a canjar ni suma meses extra.`
        )
        refreshRow(userName)
      } else {
        setPurchaseOpen(false)
        toast.success("Renovación aplicada", {
          description: `${userName} · 1 mes · ${formatMxn(result.amount)}${verifiedExpiresSuffix(result.verifiedExpiresAt)}`,
        })
        refreshRow(userName)
      }
    } catch (error) {
      // Con el panel de licencias lento la respuesta puede perderse después
      // de que el cupón se aplicó y renovó: refresca la fila para que la
      // nueva expiración sea visible. Pulsar de nuevo es seguro: el mismo
      // request_id devuelve la orden original, no un canje nuevo.
      refreshRow(userName)
      const ambiguous =
        error instanceof PagoRequestError &&
        (error.code === "network_error" ||
          error.code === "invalid_response" ||
          error.code === "timeout")
      const detail =
        error instanceof Error
          ? error.message
          : "No se pudo aplicar el cupón."
      setPayError(
        ambiguous
          ? `${detail} Puedes pulsar «Aplicar cupón» de nuevo: el canje no se duplica.`
          : detail
      )
    } finally {
      setSubmittingCoupon(false)
    }
  }, [purchaseTarget, couponCode, refreshRow])

  /**
   * Reintenta la renovación de la orden con renovación fallida de este canje:
   * sin nuevo cargo ni canje; la clave determinista de la orden evita sumar
   * meses dos veces.
   */
  const retryCouponRenewal = useCallback(async () => {
    if (!couponRetryOrderId || !purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    setSubmittingCoupon(true)
    setPayError(null)
    try {
      const result = await retryOrderRenewal(couponRetryOrderId)
      if (result.status === "renewal_failed") {
        setPayError(
          `La renovación volvió a fallar (orden ${couponRetryOrderId.slice(0, 8)}…).${result.error ? ` ${result.error}` : " Quedó registrada para revisión; inténtalo de nuevo en unos minutos."}`
        )
      } else {
        setPurchaseOpen(false)
        toast.success("Renovación aplicada", {
          description: `${userName} · 1 mes${verifiedExpiresSuffix(result.verifiedExpiresAt)}`,
        })
        refreshRow(userName)
      }
    } catch (error) {
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo reintentar la renovación."
      )
    } finally {
      setSubmittingCoupon(false)
    }
  }, [couponRetryOrderId, purchaseTarget, refreshRow])

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
            } · ${formatMxn(order.amount)}${verifiedExpiresSuffix(order.renewal_verified_expires_at)}`,
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
                  } · ${formatMxn(pollResult.order.amount)}${verifiedExpiresSuffix(pollResult.order.renewal_verified_expires_at)}`
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

      {/*
       * Revisión de transferencias y reembolsos (solo admin): las secciones
       * se montan solas cuando hay órdenes que revisar y desaparecen al
       * vaciarse.
       */}
      {canReviewTransfers ? (
        <TransferenciasReview onApproved={refreshRow} />
      ) : null}
      {canReviewTransfers ? <RefundsReview /> : null}

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
                      <span className="line-clamp-2 text-muted-foreground text-xs">
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
                    disabled={
                      purchasing || submittingTransfer || submittingCoupon
                    }
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

      {/*
       * Bottom sheet de pago (Drawer de Base UI, borde inferior con asa de
       * arrastre y swipe para cerrar). Controlado: el botón de compra de la
       * fila fija el cliente objetivo y abre; Cancelar cierra vía DrawerClose.
       * Mientras se procesa el pago no se cierra ni con Escape ni con swipe.
       *
       * Estructura: resumen compacto (usuario, plazo, importe), selector de
       * método (radio en tarjetas-fila: Mercado Pago o transferencia) y el
       * panel del método activo; la acción primaria del pie cambia con el
       * método. Sin párrafos explicativos: cada método describe su flujo en
       * una línea dentro de su propia fila.
       */}
      <Drawer
        open={purchaseOpen}
        onOpenChange={(open) => {
          if (!open && (purchasing || submittingTransfer || submittingCoupon))
            return
          // Renovación en curso (etapas no finales): el sheet no se cierra
          // detrás del bloqueo hasta terminar.
          if (
            !open &&
            renewalBlock &&
            renewalBlock.stage !== "exito" &&
            renewalBlock.stage !== "fallo"
          )
            return
          setPurchaseOpen(open)
        }}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Renovar licencia</DrawerTitle>
            <DrawerDescription>Elige cómo pagar.</DrawerDescription>
          </DrawerHeader>
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {/*
             * Resumen: solo lo relevante — a quién, cuánto y por cuánto
             * tiempo. El importe manda a la derecha en grande.
             */}
            {purchaseTarget ? (
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {purchaseTarget.userName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Renovación de 1 mes
                  </span>
                </div>
                <span className="text-lg font-semibold tabular-nums">
                  {priceMxn !== null ? formatMxn(priceMxn) : "—"}
                </span>
              </div>
            ) : null}

            {/*
             * Selector de método: filas-tarjeta con radio al final; la
             * seleccionada se resalta sola (has-data-checked del FieldLabel).
             * La transferencia solo se ofrece si el servidor tiene los datos
             * bancarios configurados; el cupón solo con el modo QA activado
             * (`COUPON_QA_ENABLED=1`).
             */}
            <RadioGroup
              value={payMethod}
              onValueChange={(value) => {
                setPayMethod(value as PayMethod)
                setPayError(null)
                setTransferRejected(null)
              }}
              aria-label="Método de pago"
            >
              <FieldGroup className="gap-0">
                <Field>
                  <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <WalletIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 opacity-60"
                      />
                      <FieldContent className="min-w-0">
                        <FieldTitle>Mercado Pago</FieldTitle>
                        <FieldDescription className="text-xs">
                          En línea · renovación automática
                        </FieldDescription>
                      </FieldContent>
                    </span>
                    <RadioGroupItem value="mercadopago" />
                  </FieldLabel>
                </Field>
                {transferBank ? (
                  <>
                    <Separator />
                    <Field>
                      <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <LandmarkIcon
                            aria-hidden="true"
                            className="size-4 shrink-0 opacity-60"
                          />
                          <FieldContent className="min-w-0">
                            <FieldTitle>Transferencia</FieldTitle>
                            <FieldDescription className="text-xs">
                              Sube tu comprobante · verificación automática
                            </FieldDescription>
                          </FieldContent>
                        </span>
                        <RadioGroupItem value="transferencia" />
                      </FieldLabel>
                    </Field>
                  </>
                ) : null}
                {couponEnabled ? (
                  <>
                    <Separator />
                    <Field>
                      <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <TicketPercentIcon
                            aria-hidden="true"
                            className="size-4 shrink-0 opacity-60"
                          />
                          <FieldContent className="min-w-0">
                            <FieldTitle>Cupón</FieldTitle>
                            <FieldDescription className="text-xs">
                              Código de {COUPON_CODE_LENGTH} dígitos ·
                              activación inmediata
                            </FieldDescription>
                          </FieldContent>
                        </span>
                        <RadioGroupItem value="cupon" />
                      </FieldLabel>
                    </Field>
                  </>
                ) : null}
              </FieldGroup>
            </RadioGroup>

            {/*
             * Panel del método activo: los datos bancarios para copiar y el
             * ticket a subir. Solo aparece con transferencia seleccionada.
             */}
            {transferBank && payMethod === "transferencia" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Banco</span>
                    <span className="font-medium">{transferBank.bank}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Titular</span>
                    <span className="truncate font-medium">
                      {transferBank.holder}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Cuenta</span>
                    <span className="flex items-center gap-1 font-medium tabular-nums">
                      {transferBank.account}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={copyAccount}
                        aria-label="Copiar la cuenta bancaria"
                      >
                        {accountCopied ? (
                          <CheckIcon aria-hidden="true" />
                        ) : (
                          <CopyIcon aria-hidden="true" />
                        )}
                      </Button>
                    </span>
                  </div>
                </div>
                <Separator />
                {/*
                 * Ticket: un archivo (foto o PDF). Sin archivo, botón de
                 * subida a ancho completo; con archivo, el chip con quitar.
                 */}
                <input
                  {...ticketActions.getInputProps({ className: "hidden" })}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                {ticketFiles.files.length === 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-dashed"
                      onClick={ticketActions.openFileDialog}
                      disabled={submittingTransfer}
                    >
                      <UploadIcon aria-hidden="true" />
                      Subir ticket
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Foto o PDF del comprobante, hasta{" "}
                      {formatBytes(TICKET_MAX_BYTES)}.
                    </p>
                  </div>
                ) : (
                  <ul className="flex flex-wrap items-center gap-1.5">
                    {ticketFiles.files.map((entry) => {
                      const file = entry.file
                      const Icon = file.type.startsWith("image/")
                        ? ImageIcon
                        : FileTextIcon
                      return (
                        <li key={entry.id} className="flex items-center gap-0.5">
                          <Badge
                            variant="secondary"
                            radius="full"
                            className="max-w-56 gap-1.5"
                            title={`${file.name} · ${formatBytes(file.size)}`}
                          >
                            <Icon className="size-3" />
                            <span className="min-w-0 truncate">{file.name}</span>
                            <span className="tabular-nums opacity-70">
                              {formatBytes(file.size)}
                            </span>
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={submittingTransfer}
                            onClick={() => ticketActions.removeFile(entry.id)}
                            aria-label={`Quitar ${file.name}`}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {ticketFiles.errors.length > 0 ? (
                  <p className="text-destructive text-xs" role="alert">
                    {ticketFiles.errors[0]}
                  </p>
                ) : null}
                {/*
                 * Veredicto del escaneo automático: el comprobante se guardó
                 * y quedó `pending`, pero no pasó alguna condición (mes,
                 * concepto, importe o beneficiario). El sheet permanece
                 * abierto para permitir subir otro comprobante y el aviso
                 * manda con el administrador la revisión manual.
                 */}
                {transferRejected ? (
                  <Alert variant="warning">
                    <TriangleAlertIcon aria-hidden="true" />
                    <AlertTitle>Comprobante no autorizado</AlertTitle>
                    <AlertDescription>
                      <p>
                        Tu comprobante no pasó la verificación automática y la
                        renovación no se aplicó. Contacta al administrador
                        para hacer una revisión manual de tu pago.
                      </p>
                      {transferRejected.reasons.length > 0 ? (
                        <ul className="mt-1.5 list-inside list-disc flex flex-col gap-0.5">
                          {transferRejected.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="mt-1.5">
                        Si el archivo era poco legible, puedes subir otro
                        comprobante.
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            {/*
             * Panel del cupón: código de 4 dígitos con InputOTP (un dígito
             * por celda). El servidor valida el código contra los cupones
             * activos al aplicar; un código inválido avisa con el Alert de
             * error compartido de abajo.
             */}
            {payMethod === "cupon" ? (
              <Field>
                <FieldLabel htmlFor="coupon-code">Código del cupón</FieldLabel>
                <div className="flex justify-center pt-1">
                  <InputOTP
                    id="coupon-code"
                    maxLength={COUPON_CODE_LENGTH}
                    pattern={REGEXP_ONLY_DIGITS}
                    value={couponCode}
                    onChange={(value) => {
                      setCouponCode(value)
                      setPayError(null)
                    }}
                    disabled={submittingCoupon}
                  >
                    <InputOTPGroup>
                      {Array.from(
                        { length: COUPON_CODE_LENGTH },
                        (_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        )
                      )}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </Field>
            ) : null}

            {priceMxn === null ? (
              <Alert variant="warning">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>Pago no configurado</AlertTitle>
                <AlertDescription>
                  <p>
                    El servidor no tiene definido el precio de la licencia
                    (LICENSE_PRICE_MXN).
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
            {payError ? (
              <Alert variant="destructive">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>El pago no se completó</AlertTitle>
                <AlertDescription>
                  <p>{payError}</p>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DrawerFooter>
            {payMethod === "cupon" && couponRetryOrderId ? (
              <Button
                size="lg"
                onClick={() => void retryCouponRenewal()}
                disabled={submittingCoupon}
              >
                {submittingCoupon ? (
                  <>
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    Reintentando…
                  </>
                ) : (
                  "Reintentar renovación"
                )}
              </Button>
            ) : payMethod === "cupon" ? (
              <Button
                size="lg"
                onClick={() => void submitCoupon()}
                disabled={
                  submittingCoupon ||
                  couponCode.length !== COUPON_CODE_LENGTH ||
                  priceMxn === null
                }
              >
                {submittingCoupon ? (
                  <>
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    Aplicando…
                  </>
                ) : (
                  "Aplicar cupón"
                )}
              </Button>
            ) : payMethod === "transferencia" && transferBank ? (
              <Button
                size="lg"
                onClick={() => void submitTransfer()}
                disabled={
                  submittingTransfer ||
                  ticketFiles.files.length === 0 ||
                  priceMxn === null
                }
              >
                {submittingTransfer ? (
                  <>
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    Enviando…
                  </>
                ) : (
                  "Enviar comprobante"
                )}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => void submitPurchase()}
                disabled={purchasing || priceMxn === null}
              >
                {purchasing ? (
                  <>
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    Abriendo checkout…
                  </>
                ) : (
                  "Pagar con Mercado Pago"
                )}
              </Button>
            )}
            <DrawerClose
              render={
                <Button
                  variant="outline"
                  size="lg"
                  disabled={
                    purchasing || submittingTransfer || submittingCoupon
                  }
                >
                  Cancelar
                </Button>
              }
            />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/*
       * Bloqueo de renovación (transferencia): cubre toda la app hasta el
       * 100% del proceso, con las etapas visibles (comprobante → renovación
       * → resultado). Solo el botón del panel final libera; si el usuario
       * recarga o cierra la pestaña, el bloqueo se restaura desde
       * localStorage y el sondeo lo conduce al mismo resultado final.
       */}
      {renewalBlock ? (
        <div
          className="bg-background/95 fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Renovación de licencia en proceso"
        >
          <Card className="w-full max-w-sm gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight">
                Renovación de licencia
              </h2>
              <p className="text-muted-foreground truncate text-xs">
                {renewalBlock.userName} · la app se libera sola al terminar
              </p>
            </div>
            <Timeline
              value={
                renewalBlock.stage === "validando"
                  ? 1
                  : renewalBlock.stage === "renovando"
                    ? 2
                    : 3
              }
              className="w-full"
            >
              {(
                [
                  {
                    id: 1,
                    title: "Comprobante",
                    description:
                      "Verificación automática: fecha del mes, concepto con el usuario, importe y beneficiario.",
                  },
                  {
                    id: 2,
                    title: "Renovación",
                    description:
                      "La licencia se renueva en el panel de FlujoTV; puede tardar varios minutos.",
                  },
                  {
                    id: 3,
                    title: "Resultado",
                    description:
                      "Confirmación final con el nuevo vencimiento verificado.",
                  },
                ] as const
              ).map((paso) => {
                const terminal =
                  renewalBlock.stage === "exito" || renewalBlock.stage === "fallo"
                const stageValue =
                  renewalBlock.stage === "validando"
                    ? 1
                    : renewalBlock.stage === "renovando"
                      ? 2
                      : 3
                const completado = terminal || paso.id < stageValue
                const enCurso =
                  !completado &&
                  paso.id === stageValue &&
                  !terminal
                return (
                  <TimelineItem
                    key={paso.id}
                    step={paso.id}
                    className="group-data-[orientation=vertical]/timeline:ms-10"
                  >
                    <TimelineHeader>
                      <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-6.5" />
                      <TimelineTitle>{paso.title}</TimelineTitle>
                      <TimelineIndicator
                        className={`flex size-6 items-center justify-center group-data-[orientation=vertical]/timeline:-left-7${
                          completado
                            ? " bg-primary text-primary-foreground border-none"
                            : ""
                        }`}
                      >
                        {completado ? (
                          <CheckIcon className="size-4" />
                        ) : enCurso ? (
                          <LoaderCircleIcon
                            aria-hidden="true"
                            className="size-4 animate-spin"
                          />
                        ) : null}
                      </TimelineIndicator>
                    </TimelineHeader>
                    <TimelineContent className="text-muted-foreground text-xs">
                      {paso.description}
                    </TimelineContent>
                  </TimelineItem>
                )
              })}
            </Timeline>
            {renewalBlock.stage === "validando" ? (
              <p className="text-muted-foreground text-xs">
                La verificación automática está en curso; en unos segundos
                continúa con la renovación.
              </p>
            ) : null}
            {renewalBlock.stage === "renovando" ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">
                  No cierres ni recargues: la pantalla se libera sola al
                  terminar.
                </p>
                {nowTick - renewalBlock.startedAt > RENEWAL_SLOW_AFTER_MS ? (
                  <p className="text-muted-foreground text-xs">
                    Sigue en proceso: el panel está tardando más de lo normal.
                  </p>
                ) : null}
              </div>
            ) : null}
            {renewalBlock.stage === "exito" ? (
              <Alert variant="success">
                <CircleCheckIcon aria-hidden="true" />
                <AlertTitle>Renovación exitosa</AlertTitle>
                <AlertDescription>
                  <p>
                    La licencia de {renewalBlock.userName} quedó renovada
                    {renewalBlock.verifiedExpiresAt
                      ? ` hasta el ${formatFlujoDate(renewalBlock.verifiedExpiresAt)}`
                      : ""}
                    .
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={releaseRenewalBlock}
                  >
                    Listo
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {renewalBlock.stage === "fallo" ? (
              <Alert variant="destructive">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>La renovación falló</AlertTitle>
                <AlertDescription>
                  <p>
                    El pago quedó registrado, pero la renovación no se pudo
                    aplicar. Contacta al administrador para reintentarla.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={releaseRenewalBlock}
                  >
                    Cerrar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
