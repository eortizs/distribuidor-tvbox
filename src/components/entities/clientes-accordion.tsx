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
 * - Contenido expandido: fecha de vencimiento ("vence 27 nov 2026") y, debajo,
 *   el nombre del distribuidor asignado al usuario (`resellerOf`: llave cruda
 *   del cliente o mapa de `/users/validity`; se omite si no tiene).
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
 *   grande) y un **selector de método de pago** SIN selección por defecto
 *   (RadioGroup en filas-tarjeta, una línea de descripción por método): no
 *   hay botón «Continuar»; tocar una de las tres opciones abre directamente
 *   su propia pantalla (la lista desaparece). «Cambiar método de pago»
 *   regresa a la lista limpiando la selección en Mercado Pago y cupón; en
 *   la transferencia no existe (al llegar ahí el comprador ya hizo la
 *   transferencia, cambiar de método ya no aplica).
 *
 *   - **Mercado Pago**: pantalla propia OBLIGATORIA antes de pagar: muestra
 *     el desglose del cargo con los tres montos — concepto (costo
 *     de licencia), costo por procesamiento (comisión 3.49% + $4 y su IVA
 *     16%, que el procesador descuenta del precio final de venta) y total a
 *     cobrar (`mpTotalMxn` engrosa el precio para que el depósito neto sea
 *     exactamente el costo de la licencia; la orden y el webhook usan ese
 *     mismo total). El primario «Pagar con Mercado Pago» solo existe en esa
 *     pantalla y llama
 *     `POST /api/mercadopago/orders`, que crea la orden `pending` y la
 *     preferencia de Mercado Pago (`purpose: wallet_purchase`: solo pagan
 *     cuentas de Mercado Pago, wallet a wallet), y redirige al `init_point`
 *     del checkout. La renovación NO ocurre aquí: el webhook
 *     `POST /api/mercadopago/webhook` verifica el pago contra la API de MP
 *     (monto, moneda, external_reference) y recién entonces renueva la
 *     licencia en el panel FlujoTV.
 *   - **Transferencia bancaria**: pantalla propia igual que Mercado Pago —
 *     elegir la fila limpia la lista y deja solo la información del pago
 *     (el importe neto sigue visible en el resumen: es el monto a
 *     transferir). Flujo de DOS pasos. Paso 1: muestra los
 *     datos bancarios del servidor (banco, titular y cuenta con botón de
 *     copiar; env `TRANSFER_*`) y el **concepto de pago** — código de 4
 *     caracteres alfanuméricos que el servidor entrega ligado al comprador y
 *     al usuario a renovar (`POST /api/transferencias/concepto`, idempotente
 *     dentro del mes: cancelar y volver muestra el mismo código; TTL mensual,
 *     y aprobarse o rechazarse la transferencia lo anula). Paso 2: tras
 *     confirmar «Ya hice la transferencia», la subida del ticket (foto o
 *     PDF, `useFileUpload`); «Enviar comprobante» crea la orden con el
 *     concepto vía `POST /api/transferencias/orders` y el servidor lo
 *     verifica con el LLM (`RECEIPT_SCAN_MODEL`): fecha dentro del mes
 *     actual, concepto con el código de pago entregado, importe de la
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
 *   - **Cupón**: pantalla propia con el código de 4 dígitos en InputOTP
 *     (ejemplo `c-input-otp-2` de ReUI); «Aplicar cupón» llama
 *     `POST /api/cupones/orders`, que valida
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
 * La pantalla compone además la **barra de filtros** sobre el listado ya
 * descargado, en **selección única**: las vistas preconfiguradas y los
 * filtros guardados son excluyentes entre sí (se combinaban con AND y
 * podían contradecirse — «Vencido» + «estado es Activo» = lista vacía—) y
 * la búsqueda se aplica encima de la que esté activa. El matching de
 * reglas vive en `matchesFilterRule` (`src/components/lab/filter-utils.ts`,
 * compartido con el Lab) y toda regla de «días para vencer» excluye a los
 * clientes vencidos, aunque el operador numérico los incluyera por sus días
 * negativos.
 *
 * La barra abre con **vistas preconfiguradas** (Toggles outline en cápsula,
 * radio
 * fijo), cada una con su contador: «Todos» — deja el listado sin condiciones
 * de ningún tipo —, «Por vencer» (regla fija hardcoded de menos de 3 días
 * solo sobre clientes vigentes), «Activo» y «Vencido» (parten el
 * listado por el estado del semáforo). Elegir una vista suelta el filtro
 * guardado activo. Las reglas fijas viven fuera de las
 * reglas del usuario, para que el operador no pueda desconfigurarlas; la
 * vista activa se pinta con el foreground del tema (negro en claro, blanco
 * en oscuro).
 *
 * Después van los **filtros compuestos guardados en la cuenta** del
 * usuario: un chip por filtro (nombre + contador del resultado sobre el
 * listado completo; la cápsula es un botón partido — aplicar + menú
 * settings-2 con Editar/Borrar integrado en ella) que al pulsarse
 * aplica su stack de reglas y su modo de agrupación, soltando la vista
 * preconfigurada activa (selección única); pulsarlo de nuevo lo suelta y
 * regresa a «Todos». Las reglas del filtro
 * activo bajan a su propio renglón como píldoras de solo lectura con conteo
 * en cascada. El botón «+» abre un **bottom sheet de creación**: nombre,
 * stack de reglas (campo → operador → valor, con el conteo como subtítulo
 * de las opciones y número para días), «Agrupar por» (ninguno/estado/socio,
 * el socio solo admin) y vista previa en vivo de cuántos clientes
 * coinciden; al guardar (POST /api/clientes/filters, tabla
 * `client_saved_filters`) el filtro queda en la cuenta y aplicado. La
 * agrupación del listado vive SOLO en los filtros guardados: no hay chips
 * de agrupación sueltos (los vio el builder). El render agrupado produce un
 * arreglo plano (encabezados con key `hdr-<grupo>` + filas con su
 * `client.id` intacta) para que alternar solo monte los encabezados y
 * reutilice las filas vivas. La validación de la carga útil vive en
 * `src/lib/client-filters.ts` y la comparten el builder y el servidor
 * (422/409). Las vistas, los filtros guardados y el «+» van en el renglón
 * superior,
 * desplazable en horizontal con el scrollbar oculto; un chevron gris
 * flotante en el margen derecho solo sugiere que la fila continúa: el
 * tooltip «deslizar» aparece al hover o tap y el tap además recorre la fila
 * hasta el final para demostrar el gesto. Con perfil distribuidor el
 * builder omite el campo Distribuidor y la opción Socio (todas las filas
 * comparten el mismo).
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { useRouter } from "next/navigation"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  ArrowUpDownIcon,
  CheckIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CopyIcon,
  FileTextIcon,
  HashIcon,
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
  Settings2Icon,
  PencilIcon,
  Trash2Icon,
  GripVerticalIcon,
} from "lucide-react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { toast } from "sonner"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import type { RealtimeMessage } from "@/components/realtime/realtime-provider"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
import { initials, pastelAvatarStyle } from "@/lib/avatar"
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"
import { formatMxn } from "@/lib/finanzas"
import {
  formatFlujoDate,
  type FlujoClient,
} from "@/lib/flujotv"
import { mpProcessingFeeMxn, mpTotalMxn } from "@/lib/mp-pricing"
import {
  buildClientFilterQuery,
  CLIENT_FILTER_ESTADO_VALUES,
  CLIENT_FILTER_MAX_RULES,
  CLIENT_FILTER_NAME_MAX,
  CLIENT_FILTER_OPERATORS,
  clientEstadoLabel,
  clientFilterRuleText,
  isClientFilterRuleComplete,
  normalizeClientFilterPayload,
  type ClientFilterField,
  type ClientFilterGroupBy,
  type ClientFilterRule,
  type ClientSavedFilter,
} from "@/lib/client-filters"

import {
  fetchFlujoClient,
  fetchFlujoClients,
  fetchFlujoResellers,
  refreshFlujo,
} from "@/components/lab/flujo-api"
import {
  createPaymentOrder,
  createCouponOrder,
  createTransferConcept,
  createTransferOrder,
  fetchPaymentOrder,
  retryOrderRenewal,
  PagoRequestError,
  type PaymentOrder,
  type TransferConcept,
} from "./pago-api"
import { TransferenciasReview } from "./transferencias-review"
import { RefundsReview } from "./refunds-review"
import {
  applyFilterQuery,
  matchesFilterRule,
} from "@/components/lab/filter-utils"

type FetchState = "loading" | "success" | "error"

/** Métodos de pago del bottom sheet de renovación. */
type PayMethod = "mercadopago" | "transferencia" | "cupon"

/**
 * Pasos del flujo de transferencia bancaria: primero el concepto de pago
 * (código de 4 caracteres que el comprador escribe en su transferencia) y
 * después la subida del comprobante, que el servidor valida contra ese
 * código.
 */
type TransferStep = "concepto" | "comprobante"

/** Tamaño máximo del ticket de transferencia (igual que el servidor). */
const TICKET_MAX_BYTES = 10 * 1024 * 1024

/** Longitud del código de cupón. */
const COUPON_CODE_LENGTH = 4

/**
 * Catálogos «valor → etiqueta» para los Select del builder de filtros. En
 * Base UI, sin la prop `items` el trigger muestra el valor crudo («lt»,
 * «estado», «__sin_distribuidor__») en vez de la etiqueta del ítem elegido,
 * lo que se lee como un error.
 */
const CLIENT_FILTER_FIELD_ITEMS = [
  { value: "estado", label: "Estado" },
  { value: "reseller", label: "Distribuidor" },
  { value: "dias", label: "Días para vencer" },
]

const CLIENT_FILTER_ESTADO_ITEMS = CLIENT_FILTER_ESTADO_VALUES.map((value) => ({
  value,
  label: clientEstadoLabel(value),
}))

/**
 * Renglón arrastrable del bottom sheet «Reordenar» (dnd-kit sortable): asa
 * de agarre + título (vista o filtro) + descripción + posición. El propio
 * dnd-kit mueve el renglón con transform/transition; al arrastrar sube el
 * borde para que se vea qué fila sostiene el dedo.
 */
function SortableChipRow({ chip, index }: { chip: ClientChip; index: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chip.key })
  const title = chip.kind === "preset" ? chip.item.label : chip.filter.name
  const description =
    chip.kind === "preset"
      ? "Vista preconfigurada"
      : chip.filter.rules.length > 0
        ? chip.filter.rules.map(clientFilterRuleText).join(" · ")
        : "Solo agrupa el listado"
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`flex select-none items-center gap-2 rounded-lg border px-2 py-2 ${
        isDragging
          ? "border-ring bg-background shadow-md"
          : "bg-background"
      }`}
    >
      <button
        type="button"
        aria-label={`Arrastrar para reordenar ${title}`}
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-full [-webkit-touch-callout:none] active:cursor-grabbing"
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="text-muted-foreground truncate text-xs">{description}</p>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {index + 1}
      </span>
    </div>
  )
}

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

/** Etiqueta del mes vigente del concepto de pago: «Noviembre 2026». */
function formatCurrentMonth(): string {
  const label = new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
  }).format(new Date())
  return label.charAt(0).toUpperCase() + label.slice(1)
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

/**
 * Un chip de la hilera de filtros: vista preconfigurada (fija de la app) o
 * filtro guardado de la cuenta. La clave es la identidad del chip en el
 * layout guardado (`preset:<valor>` / `filter:<id>`), el idioma común entre
 * la barra y el bottom sheet «Reordenar».
 */
type ClientChip =
  | { key: string; kind: "preset"; item: { value: ClientPreset; label: string } }
  | { key: string; kind: "filter"; filter: ClientSavedFilter }

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
  /** Perfil admin: habilita la opción Socio del «Agrupar por» y el campo Distribuidor. */
  isAdmin?: boolean
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
  isAdmin = false,
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
  /**
   * Agrupación viva del listado: «ninguno» (plano), «estado» (Activo /
   * Inactivo) o «socio» (una sección por distribuidor, solo admin). La fija
   * exclusivamente el filtro guardado activo — no hay chips sueltos.
   */
  const [grouping, setGrouping] = useState<ClientFilterGroupBy>("ninguno")
  /**
   * Grupos cuyo orden interno quedó invertido por su botón de orden (Z→A).
   * Por defecto cada sección se ordena ascendente (A→Z); la ausencia en el
   * conjunto ES el estado ascendente, sin inicialización por grupo.
   */
  const [descendingGroups, setDescendingGroups] = useState<Set<string>>(
    () => new Set()
  )
  /** Alterna el orden interno de una sección: A→Z ↔ Z→A. */
  const toggleGroupSort = useCallback((key: string) => {
    setDescendingGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  /**
   * Orden del listado plano (vistas y filtros sin agrupación): A→Z por
   * defecto y Z→A al pulsar el botón de orden bajo la línea de filtros,
   * el mismo control del modo agrupado para que el gesto sea idéntico
   * sin importar el filtro activo.
   */
  const [flatDescending, setFlatDescending] = useState(false)
  /**
   * Secciones expandidas del modo agrupado: vacío = todas colapsadas (el
   * estado por defecto). El acordeón de cada grupo es controlado con este
   * conjunto para que los botones globales (expandir/colapsar todos) y el
   * toque individual compartan la misma fuente de verdad.
   */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  )
  /**
   * Filtros compuestos guardados en la cuenta del usuario (nombre + stack de
   * reglas + modo de agrupación), servidos por /api/clientes/filters.
   */
  const [savedFilters, setSavedFilters] = useState<ClientSavedFilter[]>([])
  /**
   * Orden manual de TODA la hilera de chips (vistas + filtros guardados),
   * como lista de claves `preset:<valor>` / `filter:<id>`; null = la hilera
   * usa su orden natural (vistas primero, filtros por creación).
   */
  const [chipLayout, setChipLayout] = useState<string[] | null>(null)
  /** Filtro guardado aplicado; null = vista sin filtro guardado. */
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null)
  /** Bottom sheet de creación: nombre, stack de reglas y agrupación. */
  const [builderOpen, setBuilderOpen] = useState(false)
  /** Ventana flotante «Reordenar»: drag & drop del orden de la hilera. */
  const [reorderOpen, setReorderOpen] = useState(false)
  /**
   * Sensores del reorden: puntero unificado (mouse/touch/lápiz) que activa
   * el arrastre tras 6px de recorrido — RESPUESTA INMEDIATA, sin pulsación
   * larga que se sienta muerta — y teclado (foco + espacio/flechas) como
   * vía accesible. El asa tiene `touch-action: none`, así el gesto vertical
   * sobre ella nunca compite con el scroll del listado.
   */
  const reorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  /**
   * Suelta un renglón del reorden: mueve el filtro en el estado (optimista,
   * los chips se reordenan al instante) y persiste el orden completo en la
   * cuenta; si la API falla, revierte y avisa.
   */
  /**
   * Chips de la hilera de filtros en su orden final: vistas preconfiguradas
   * y filtros guardados unificados, con el layout guardado del usuario por
   * delante y los chips nuevos (no conocidos por el layout) al final en su
   * orden natural.
   */
  const chips = useMemo<ClientChip[]>(() => {
    const natural: ClientChip[] = [
      ...PRESET_ITEMS.map((item) => ({
        key: `preset:${item.value}`,
        kind: "preset" as const,
        item,
      })),
      ...savedFilters.map((filter) => ({
        key: `filter:${filter.id}`,
        kind: "filter" as const,
        filter,
      })),
    ]
    if (!chipLayout || chipLayout.length === 0) return natural
    const byKey = new Map(natural.map((chip) => [chip.key, chip]))
    const ordered: ClientChip[] = []
    const seen = new Set<string>()
    for (const key of chipLayout) {
      const chip = byKey.get(key)
      if (chip && !seen.has(key)) {
        ordered.push(chip)
        seen.add(key)
      }
    }
    for (const chip of natural) {
      if (!seen.has(chip.key)) ordered.push(chip)
    }
    return ordered
  }, [chipLayout, savedFilters])

  /**
   * Suelta un renglón del reorden de la HILERA COMPLETA (vistas + filtros):
   * fija el orden nuevo de los chips (optimista, la barra se reordena al
   * instante) y persiste la lista de claves en la cuenta; si la API falla,
   * revierte y avisa.
   */
  const handleReorderDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = chips.findIndex((chip) => chip.key === active.id)
      const newIndex = chips.findIndex((chip) => chip.key === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const previous = chipLayout
      const next = arrayMove(chips, oldIndex, newIndex).map(
        (chip) => chip.key
      )
      setChipLayout(next)
      try {
        const response = await fetch("/api/clientes/chips", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order: next }),
        })
        if (!response.ok) throw new Error("reorden_rechazado")
      } catch {
        setChipLayout(previous)
        toast.error("No se pudo guardar el nuevo orden", {
          description: "Inténtalo de nuevo en unos segundos.",
        })
      }
    },
    [chips, chipLayout]
  )
  /** Id del filtro que se está editando; null = el sheet crea uno nuevo. */
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftGroupBy, setDraftGroupBy] = useState<ClientFilterGroupBy>("ninguno")
  const [draftRules, setDraftRules] = useState<ClientFilterRule[]>([])
  const [savingFilter, setSavingFilter] = useState(false)
  /** Filtro guardado pendiente de confirmar su eliminación. */
  const [deleteTarget, setDeleteTarget] = useState<ClientSavedFilter | null>(null)
  const [deletingFilter, setDeletingFilter] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  /**
   * Tooltip de la pista «deslizar» del renglón de filtros: controlado para
   * que el tap en móvil lo abra (el hover de Base UI es solo-mouse, así que
   * sin control el tap no haría nada) y el toque fuera lo cierre.
   */
  const [swipeHintOpen, setSwipeHintOpen] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseTarget, setPurchaseTarget] = useState<FlujoClient | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  /**
   * Método elegido en el sheet; null = lista sin selección: al abrir no hay
   * método por defecto y el usuario elige entre las tres opciones. Cada
   * opción abre su propia pantalla (la lista desaparece) y «Cambiar método
   * de pago» regresa a la lista limpiando la selección.
   */
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null)
  /** Desglose de Mercado Pago activo: concepto, procesamiento y total. */
  const mpBreakdown = payMethod === "mercadopago"
  const [submittingTransfer, setSubmittingTransfer] = useState(false)
  /**
   * Paso actual de la transferencia: el concepto de pago se entrega primero
   * (paso 1) y el comprobante se sube después (paso 2).
   */
  const [transferStep, setTransferStep] = useState<TransferStep>("concepto")
  /**
   * Concepto de pago vigente para el cliente objetivo (código de 4
   * caracteres + mes). Idempotente en el servidor: cancelar y volver
   * entrega el mismo código mientras dure el mes.
   */
  const [transferConcept, setTransferConcept] = useState<TransferConcept | null>(
    null
  )
  /** Fallo al generar el concepto (con botón de reintento en el panel). */
  const [conceptError, setConceptError] = useState<string | null>(null)
  const [conceptCopied, setConceptCopied] = useState(false)
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
   * Renglón desplazable de vistas: el chevron de la pista «deslizar» lo
   * recorre con desplazamiento suave al hacer tap.
   */
  const filterRowRef = useRef<HTMLDivElement>(null)

  /**
   * Llave del concepto de pago ya pedido (usuario + mes): evita repetir la
   * petición al re-seleccionar el método y evita un bucle de reintentos
   * tras un fallo (el reintento es explícito, con el botón del panel).
   */
  const conceptRequestedKey = useRef("")

  /**
   * Filtros compuestos guardados de la cuenta: se cargan al montar. Un fallo
   * de red los deja en silencio (la lista aparece vacía y la creación avisará
   * con toast si el problema persiste); los setState ocurren al resolver la
   * petición, nunca en el cuerpo del efecto.
   */
  useEffect(() => {
    fetch("/api/clientes/filters", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          json:
            | { ok?: boolean; data?: ClientSavedFilter[] }
            | null
        ) => {
          if (json?.ok && Array.isArray(json.data)) setSavedFilters(json.data)
        }
      )
      .catch(() => {
        // Sin filtros guardados legibles: la barra funciona igual.
      })
    fetch("/api/clientes/chips", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          json: { ok?: boolean; data?: { order?: string[] | null } } | null
        ) => {
          if (json?.ok && Array.isArray(json.data?.order)) {
            setChipLayout(json.data.order as string[])
          }
        }
      )
      .catch(() => {
        // Sin orden guardado legible: la hilera usa su orden natural.
      })
  }, [])

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
   * Tap en la pista «deslizar»: despliega el tooltip y recorre la fila de
   * vistas hasta el final con desplazamiento suave — el recorrido hace obvio
   * que la fila se puede deslizar. Si ya está al final, un tap regresa al
   * inicio. Respeta `prefers-reduced-motion` con salto instantáneo.
   */
  const runSwipeHint = useCallback(() => {
    setSwipeHintOpen(true)
    const row = filterRowRef.current
    if (!row) return
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    row.scrollTo({
      left: atEnd ? 0 : row.scrollWidth,
      behavior: reduceMotion ? "auto" : "smooth",
    })
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
      setPayMethod(null)
      setPayError(null)
      setTransferRejected(null)
      setTransferStep("concepto")
      setTransferConcept(null)
      setConceptError(null)
      setConceptCopied(false)
      conceptRequestedKey.current = ""
      setCouponCode("")
      setCouponRetryOrderId(null)
      couponRequestIdRef.current =
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      ticketActions.clearFiles()
      setPurchaseOpen(true)
    },
    [ticketActions]
  )

  /**
   * Paso 1 de la transferencia: pide el concepto de pago vigente para el
   * comprador + usuario. Una sola petición por usuario y mes: al volver a
   * elegir el método en el mismo mes, el mismo código reaparece sin otra
   * llamada (y tras un fallo no hay bucle: el reintento es el botón). Solo
   * toca refs de forma síncrona; los setState ocurren al resolver la
   * petición (el efecto no encadena renders).
   */
  const loadTransferConcept = useCallback(async (userName: string) => {
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const expectedKey = `${userName}:${monthKey}`
    if (conceptRequestedKey.current === expectedKey) return
    conceptRequestedKey.current = expectedKey
    try {
      const concept = await createTransferConcept({ userName })
      // Solo aplica si sigue siendo la petición dueña: el comprador pudo
      // cambiar de cliente mientras volaba (la respuesta de A no pisa a B).
      if (conceptRequestedKey.current !== expectedKey) return
      setTransferConcept(concept)
      setConceptError(null)
    } catch (error) {
      if (conceptRequestedKey.current !== expectedKey) return
      conceptRequestedKey.current = ""
      setConceptError(
        error instanceof Error
          ? error.message
          : "No se pudo generar el concepto de pago."
      )
    }
  }, [])

  /**
   * Carga del concepto derivada: mientras el método es transferencia, no hay
   * código ni error de generación, la petición está en curso.
   */
  const loadingConcept =
    purchaseOpen &&
    payMethod === "transferencia" &&
    transferConcept === null &&
    conceptError === null

  /** Al elegir transferencia se abre el paso 1 y se pide el concepto. */
  useEffect(() => {
    if (!purchaseOpen || payMethod !== "transferencia" || !purchaseTarget) {
      return
    }
    // La petición corre en un microtask (mismo patrón que la restauración de
    // filtros): el primer pintado no espera a la red ni encadena renders.
    const userName = purchaseTarget.userName.trim()
    void Promise.resolve().then(() => loadTransferConcept(userName))
  }, [purchaseOpen, payMethod, purchaseTarget, loadTransferConcept])

  /** Copia el concepto de pago al portapapeles con feedback breve. */
  const copyConcept = useCallback(() => {
    if (!transferConcept) return
    navigator.clipboard
      .writeText(transferConcept.code)
      .then(() => {
        setConceptCopied(true)
        window.setTimeout(() => setConceptCopied(false), 2000)
      })
      .catch(() => {
        toast.error("No se pudo copiar el concepto.")
      })
  }, [transferConcept])

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
    if (!purchaseTarget || !transferConcept) return
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
      const result = await createTransferOrder({
        userName,
        months: 1,
        concepto: transferConcept.code,
        file: ticket,
      })
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
      // Concepto anulado en el servidor (transferencia aprobada/rechazada)
      // o vencido por cambio de mes: el código en pantalla ya no sirve, así
      // que se descarta y el paso 1 re-consulta el vigente al instante.
      if (error instanceof PagoRequestError && error.code === "concepto_invalido") {
        conceptRequestedKey.current = ""
        setTransferConcept(null)
        setConceptError(null)
        setConceptCopied(false)
        setTransferStep("concepto")
        void loadTransferConcept(userName)
      }
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el comprobante."
      )
    } finally {
      setSubmittingTransfer(false)
    }
  }, [purchaseTarget, transferConcept, ticketActions, ticketFiles, loadTransferConcept])

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

  /**
   * Opciones de distribuidor para el builder: la lista real del panel, más
   * «Sin distribuidor» (valor vacío). El Select no usa la cadena vacía como
   * valor de ítem, así que viaja con el centinela y se mapea al guardar.
   */
  const SIN_DISTRIBUIDOR_OPTION = "__sin_distribuidor__"
  const resellerOptions = useMemo(
    () => [
      ...[...new Set(resellerNames)]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((name) => ({
          value: name,
          label: name,
          description: optionCount(resellerCounts.get(name)),
        })),
      {
        value: SIN_DISTRIBUIDOR_OPTION,
        label: "Sin distribuidor",
        description: optionCount(resellerCounts.get("")),
      },
    ],
    [resellerNames, resellerCounts]
  )

  /** Filtro guardado aplicado (o null). */
  const activeFilter =
    savedFilters.find((filter) => filter.id === activeFilterId) ?? null

  /** Accesores del motor de filtros sobre la fila de cliente. */
  const filterAccessors = useMemo(
    () => ({
      estado: (row: FlujoClient) => row.statusLabel,
      reseller: resellerOf,
      dias: (row: FlujoClient) => row.daysRemaining,
    }),
    [resellerOf]
  )

  /** Las reglas del filtro activo como consulta del motor (grupo AND). */
  const activeFilterQuery = useMemo(
    () => (activeFilter ? buildClientFilterQuery(activeFilter.rules) : null),
    [activeFilter]
  )

  const filtered = useMemo(() => {
    // El campo «días para vencer» solo considera clientes vigentes: cualquier
    // regla sobre días excluye a los vencidos, aunque el operador numérico
    // (p. ej. «menor que») los incluyera por sus días negativos.
    const hasDiasRule =
      activeFilter?.rules.some(
        (rule) => rule.field === "dias" && isClientFilterRuleComplete(rule)
      ) ?? false
    const eligible = hasDiasRule
      ? clients.filter((client) => client.statusLabel !== "vencido")
      : clients
    // Vista preconfigurada: regla fija FUERA de las reglas del usuario, para
    // que el operador no pueda desconfigurarla; «Por vencer» excluye vencidos.
    const withPreset =
      preset === "todos"
        ? eligible
        : eligible.filter((client) => matchesPreset(client, preset))
    const byFilter = activeFilterQuery
      ? applyFilterQuery(withPreset, activeFilterQuery, filterAccessors)
      : withPreset
    const term = foldTerm(searchInput)
    if (!term) return byFilter
    return byFilter.filter(
      (client) =>
        foldTerm(client.userName).includes(term) ||
        foldTerm(client.email ?? "").includes(term) ||
        foldTerm(clientName(client, clientNames)).includes(term)
    )
  }, [
    clients,
    preset,
    activeFilter,
    activeFilterQuery,
    filterAccessors,
    searchInput,
    clientNames,
  ])

  const searching = searchInput.trim().length > 0
  const hasFilters =
    (activeFilter?.rules.length ?? 0) > 0 ||
    preset !== "todos" ||
    grouping !== "ninguno"

  /**
   * Secciones de la agrupación por estado, calculadas sobre el listado ya
   * filtrado (vista preconfigurada + filtro guardado + búsqueda): «Activo»
   * junta el semáforo en activo e «Inactivo» todo lo demás (vencidos,
   * pendientes y pruebas). Las secciones sin clientes se omiten para no
   * imprimir encabezados vacíos.
   */
  const statusGroups = useMemo(
    () =>
      [
        {
          key: "activo",
          label: "Activo",
          dotClass: "bg-success",
          clients: filtered.filter((client) => client.statusLabel === "activo"),
        },
        {
          key: "inactivo",
          label: "Inactivo",
          dotClass: "bg-muted-foreground/40",
          clients: filtered.filter((client) => client.statusLabel !== "activo"),
        },
      ].filter((group) => group.clients.length > 0),
    [filtered]
  )

  /**
   * Secciones de la agrupación por socio (solo admin), sobre el listado ya
   * filtrado: una sección por distribuidor asignado (`resellerOf`, la misma
   * fuente del campo Distribuidor del builder), ordenadas alfabéticamente y
   * con los clientes sin socio al final bajo «Sin socio». Cada sección lleva
   * el par pastel estable del socio (la paleta de avatares, sembrada por su
   * nombre) para el punto del encabezado. Las secciones vacías no existen:
   * solo se crean con clientes.
   */
  const socioGroups = useMemo(() => {
    const byReseller = new Map<string, FlujoClient[]>()
    for (const client of filtered) {
      const reseller = resellerOf(client)
      const bucket = byReseller.get(reseller)
      if (bucket) bucket.push(client)
      else byReseller.set(reseller, [client])
    }
    return [...byReseller.entries()]
      .sort(([a], [b]) => {
        if (!a) return 1
        if (!b) return -1
        return a.localeCompare(b, "es")
      })
      .map(([reseller, groupClients]) => ({
        key: reseller || "sin-socio",
        label: reseller || "Sin socio",
        dotStyle: pastelAvatarStyle(reseller || "sin-socio"),
        clients: groupClients,
      }))
  }, [filtered, resellerOf])

  /**
   * Listado plano ordenado por usuario, A→Z por defecto y Z→A al pulsar el
   * botón de orden bajo la línea de filtros (mismo gesto que el orden
   * interno de las secciones del modo agrupado). Sin agrupación este botón
   * es la única vía de orden del panel, así que no depende del orden crudo
   * en que el listado llega del panel de FlujoTV.
   */
  const sortedFlat = useMemo(() => {
    const rows = [...filtered].sort((a, b) =>
      a.userName.localeCompare(b.userName, "es")
    )
    return flatDescending ? rows.reverse() : rows
  }, [filtered, flatDescending])

  /**
   * Conteo de un filtro sobre el listado completo (lo que muestra su chip):
   * mismas reglas de elegibilidad que la vista (días excluye vencidos).
   */
  const countFilterMatches = useCallback(
    (filter: ClientSavedFilter): number => {
      const hasDiasRule = filter.rules.some(
        (rule) => rule.field === "dias" && isClientFilterRuleComplete(rule)
      )
      const rows = hasDiasRule
        ? clients.filter((client) => client.statusLabel !== "vencido")
        : clients
      return applyFilterQuery(
        rows,
        buildClientFilterQuery(filter.rules),
        filterAccessors
      ).length
    },
    [clients, filterAccessors]
  )

  /** Contador por filtro guardado, para el chip de cada uno. */
  const savedFilterCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const filter of savedFilters) {
      counts.set(filter.id, countFilterMatches(filter))
    }
    return counts
  }, [savedFilters, countFilterMatches])

  /**
   * Conteos en cascada de las reglas del filtro activo: la primera cuenta
   * sobre el listado completo y cada siguiente sobre el resultado de la
   * anterior (igual que los chips de la consulta efímera que sustituyeron).
   */
  const activeRuleCounts = useMemo(() => {
    if (!activeFilter) return []
    const counts: number[] = []
    let rows = clients
    activeFilter.rules.forEach((rule, index) => {
      const accessor =
        rule.field === "estado"
          ? filterAccessors.estado
          : rule.field === "reseller"
            ? filterAccessors.reseller
            : filterAccessors.dias
      const engineRule = {
        id: `rule-${index + 1}`,
        type: "rule" as const,
        path: [rule.field],
        operator: rule.operator,
        value: rule.value ?? undefined,
      }
      rows = rows.filter((row) =>
        rule.field === "dias" && row.statusLabel === "vencido"
          ? false
          : matchesFilterRule(engineRule, row, accessor)
      )
      counts.push(rows.length)
    })
    return counts
  }, [activeFilter, clients, filterAccessors])

  /**
   * Aplica (o suelta) un filtro guardado: al aplicarlo fija también su modo
   * de agrupación — la única vía de agrupar el listado —, al soltarlo la
   * agrupación vuelve a plana y la vista vuelve a «Todos».
   *
   * SELECCIÓN ÚNICA: las vistas preconfiguradas y los filtros guardados son
   * excluyentes entre sí. Se combinaban con AND y podían contradecirse (vista
   * «Vencido» + filtro con «estado es Activo» = lista vacía), así que aplicar
   * un filtro suelta la vista activa y elegir una vista suelta el filtro.
   */
  const applySavedFilter = useCallback((filter: ClientSavedFilter | null) => {
    setActiveFilterId(filter?.id ?? null)
    setGrouping(filter?.groupBy ?? "ninguno")
    if (filter) setPreset("todos")
  }, [])

  /** Abre el builder con borrón y cuenta nueva (modo creación). */
  const openBuilder = useCallback(() => {
    setEditingFilterId(null)
    setDraftName("")
    setDraftGroupBy("ninguno")
    setDraftRules([])
    setBuilderOpen(true)
  }, [])

  /**
   * Abre el builder precargado con el filtro a editar (menú settings-2 del
   * chip): mismo formulario, mismo guardado validado, pero PATCH sobre la
   * fila existente en vez de POST.
   */
  const openEditFilter = useCallback((filter: ClientSavedFilter) => {
    setEditingFilterId(filter.id)
    setDraftName(filter.name)
    setDraftGroupBy(filter.groupBy)
    setDraftRules(filter.rules.map((rule) => ({ ...rule })))
    setBuilderOpen(true)
  }, [])

  const closeBuilder = useCallback(() => {
    if (savingFilter) return
    setBuilderOpen(false)
    setEditingFilterId(null)
    setDraftName("")
    setDraftGroupBy("ninguno")
    setDraftRules([])
  }, [savingFilter])

  const addDraftRule = useCallback(() => {
    setDraftRules((rules) =>
      rules.length >= CLIENT_FILTER_MAX_RULES
        ? rules
        : [...rules, { field: "estado", operator: "is", value: null }]
    )
  }, [])

  const removeDraftRule = useCallback((index: number) => {
    setDraftRules((rules) => rules.filter((_, i) => i !== index))
  }, [])

  /** Cambia el campo de una regla: operador y valor vuelven al default limpio. */
  const changeDraftRuleField = useCallback(
    (index: number, field: ClientFilterField) => {
      setDraftRules((rules) =>
        rules.map((rule, i) =>
          i === index
            ? field === "dias"
              ? { field, operator: "lt", value: null }
              : { field, operator: "is", value: null }
            : rule
        )
      )
    },
    []
  )

  const updateDraftRule = useCallback(
    (index: number, patch: Partial<ClientFilterRule>) => {
      setDraftRules((rules) =>
        rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
      )
    },
    []
  )

  /** Nombre válido y sin duplicados en la cuenta (el propio filtro editado no cuenta). */
  const draftNameTrim = draftName.trim()
  const draftNameDuplicated = savedFilters.some(
    (filter) =>
      filter.id !== editingFilterId &&
      filter.name.trim().toLowerCase() === draftNameTrim.toLowerCase()
  )
  const draftRulesComplete = draftRules.every(isClientFilterRuleComplete)
  const draftDoesSomething =
    draftRules.length > 0 || draftGroupBy !== "ninguno"
  const draftValid =
    draftNameTrim.length >= 1 &&
    draftNameTrim.length <= CLIENT_FILTER_NAME_MAX &&
    !draftNameDuplicated &&
    draftRulesComplete &&
    draftDoesSomething

  /** Vista previa en vivo: cuántos clientes del listado cargado coinciden. */
  const draftPreview = useMemo(() => {
    const hasDiasRule = draftRules.some(
      (rule) => rule.field === "dias" && isClientFilterRuleComplete(rule)
    )
    const rows = hasDiasRule
      ? clients.filter((client) => client.statusLabel !== "vencido")
      : clients
    return applyFilterQuery(
      rows,
      buildClientFilterQuery(draftRules),
      filterAccessors
    ).length
  }, [draftRules, clients, filterAccessors])

  /**
   * Guarda el filtro en la cuenta y lo deja aplicado: POST para uno nuevo,
   * PATCH cuando el sheet se abrió en modo edición (menú del chip).
   */
  const saveDraftFilter = useCallback(async () => {
    const normalized = normalizeClientFilterPayload(
      { name: draftName, groupBy: draftGroupBy, rules: draftRules },
      { isAdmin }
    )
    if (!normalized.ok) {
      toast.error(normalized.error)
      return
    }
    const editing = editingFilterId !== null
    setSavingFilter(true)
    try {
      const response = await fetch(
        editing
          ? `/api/clientes/filters/${encodeURIComponent(editingFilterId)}`
          : "/api/clientes/filters",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(normalized.value),
        }
      )
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean
        data?: ClientSavedFilter
        error?: { message?: string }
      } | null
      if (!response.ok || !json?.ok || !json.data) {
        toast.error(
          json?.error?.message ??
            (editing
              ? "No se pudo actualizar el filtro"
              : "No se pudo guardar el filtro")
        )
        return
      }
      const saved = json.data
      setSavedFilters((current) =>
        editing
          ? current.map((filter) =>
              filter.id === saved.id ? saved : filter
            )
          : [...current, saved]
      )
      // Aplicar también re-sincroniza la agrupación y suelta la vista: si el
      // filtro editado estaba activo, la vista refleja el cambio al instante.
      applySavedFilter(saved)
      setBuilderOpen(false)
      setEditingFilterId(null)
      setDraftName("")
      setDraftGroupBy("ninguno")
      setDraftRules([])
      toast.success(
        editing
          ? `Filtro «${saved.name}» actualizado`
          : `Filtro «${saved.name}» guardado en tu cuenta`
      )
    } catch {
      toast.error(
        editing
          ? "No se pudo actualizar el filtro"
          : "No se pudo guardar el filtro"
      )
    } finally {
      setSavingFilter(false)
    }
  }, [
    draftName,
    draftGroupBy,
    draftRules,
    isAdmin,
    editingFilterId,
    applySavedFilter,
  ])

  /** Elimina un filtro guardado (tras confirmar en el AlertDialog). */
  const runDeleteFilter = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    setDeletingFilter(true)
    try {
      const response = await fetch(
        `/api/clientes/filters/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        toast.error("No se pudo eliminar el filtro")
        return
      }
      setSavedFilters((current) =>
        current.filter((filter) => filter.id !== target.id)
      )
      if (activeFilterId === target.id) applySavedFilter(null)
      setDeleteTarget(null)
      toast.success(`Filtro «${target.name}» eliminado`)
    } catch {
      toast.error("No se pudo eliminar el filtro")
    } finally {
      setDeletingFilter(false)
    }
  }, [deleteTarget, activeFilterId, applySavedFilter])

  /**
   * Renglón de un cliente en el listado (fila plegable + panel de detalle).
   * Extraído del mapa original para reutilizarlo tal cual en el modo plano y
   * dentro de cada sección de la agrupación por estado.
   */
  const renderClientItem = (client: FlujoClient) => (
    <AccordionItem
      key={client.id}
      value={client.id}
      className="not-last:border-b-0 bg-transparent p-0"
    >
      <div className="relative">
        <AccordionTrigger className="items-center gap-3 rounded-lg px-1.5 py-2.5 hover:bg-muted hover:no-underline focus-visible:border-transparent focus-visible:ring-0 dark:hover:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden">
          <Avatar className="size-12">
            <AvatarFallback
              style={pastelAvatarStyle(client.id || client.userName)}
            >
              {initials(client.userName)}
            </AvatarFallback>
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
            disabled={purchasing || submittingTransfer || submittingCoupon}
            aria-label={`Comprar 1 mes para ${client.userName}`}
            className="pointer-events-auto h-9 w-9 shrink-0 rounded-full text-black dark:text-white transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 active:bg-primary/15 active:text-primary motion-reduce:active:scale-100"
          >
            <ShoppingCartPlusIcon aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </div>
      <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
        <div className="flex flex-col gap-1 pb-1 text-xs">
          <span className="truncate">
            vence {formatFlujoDate(client.expiresAt)}
          </span>
          {resellerOf(client) ? (
            <span className="truncate">
              socio: {resellerOf(client)}
            </span>
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  )

  /**
   * Sección colapsable del modo agrupado: el encabezado (punto + etiqueta +
   * contador + botón de orden) es el trigger de un acordeón propio CONTROLADO
   * por `expandedGroups` (cerrado por defecto), y el panel contiene las filas
   * de sus clientes en otro acordeón anidado (una fila abierta a la vez por
   * sección, igual que el modo plano). Las filas se ordenan por usuario,
   * ascendente por defecto y Z→A al pulsar el botón; el botón no abre la
   * sección (corta la propagación del click del trigger). Las keys de las
   * filas no cambian, así que colapsar y expandir reutiliza las filas vivas
   * en vez de remontarlas.
   */
  const renderGroup = (group: {
    key: string
    label: string
    dotStyle?: CSSProperties
    dotClass?: string
    clients: FlujoClient[]
  }) => {
    const descending = descendingGroups.has(group.key)
    const sortedClients = [...group.clients].sort((a, b) => {
      const comparison = a.userName.localeCompare(b.userName, "es")
      return descending ? -comparison : comparison
    })
    const groupValue = `grp-${group.key}`
    return (
      <Accordion
        key={groupValue}
        value={expandedGroups.has(group.key) ? [groupValue] : []}
        onValueChange={(values) => {
          setExpandedGroups((previous) => {
            const next = new Set(previous)
            if (values.includes(groupValue)) next.add(group.key)
            else next.delete(group.key)
            return next
          })
        }}
        className="gap-0"
      >
        <AccordionItem value={groupValue} className="border-b-0">
          <AccordionTrigger className="justify-start items-center gap-2 rounded-lg bg-muted/60 px-1.5 pt-2 pb-1 text-xs font-medium tracking-tight text-muted-foreground hover:bg-muted hover:no-underline [&_[data-slot=accordion-trigger-icon]]:ml-0">
            {/*
             * Punto del encabezado: par pastel estable del socio (paleta de
             * avatares) en la agrupación por socio o semáforo por estado;
             * «Inactivo» lleva punto neutro porque junta estados varios
             * (vencidos, pendientes y pruebas); el detalle vive en cada fila.
             */}
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${group.dotClass ?? ""}`}
              style={group.dotStyle}
            />
            <span className="truncate">{group.label}</span>
            <Badge
              variant="outline"
              size="xs"
              className="text-muted-foreground tabular-nums"
            >
              {group.clients.length}
            </Badge>
            {/*
             * Orden interno de la sección: A→Z por defecto, Z→A al pulsar.
             * Vive DENTRO del trigger pero no debe abrir ni cerrar el grupo:
             * corta la propagación del click antes de que llegue al trigger.
             * El ml-auto es el ÚNICO margen flexible del renglón (el chevron
             * lo pierde con ml-0), así que el botón queda anclado al margen
             * derecho, inmediatamente a la izquierda del chevron. size-8 por
             * el área táctil mínima en móvil.
             */}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground ml-auto size-8 shrink-0 rounded-full hover:bg-background/60"
              aria-pressed={descending}
              aria-label={
                descending
                  ? `Ordenar ${group.label} en ascendente`
                  : `Ordenar ${group.label} en descendente`
              }
              onClick={(event) => {
                event.stopPropagation()
                toggleGroupSort(group.key)
              }}
            >
              {descending ? (
                <ArrowDownAZIcon aria-hidden="true" className="size-4" />
              ) : (
                <ArrowUpAZIcon aria-hidden="true" className="size-4" />
              )}
            </Button>
          </AccordionTrigger>
          <AccordionContent className="pb-1">
            <Accordion multiple={false}>
              {sortedClients.map(renderClientItem)}
            </Accordion>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  /**
   * Estado global de las secciones (solo modo agrupado): las keys visibles
   * ahora y si TODAS comparten orden descendente o están expandidas. Manda
   * el icono de los botones globales: muestran la acción que van a ejecutar
   * sobre el conjunto.
   */
  const groupedKeys =
    grouping === "socio"
      ? socioGroups.map((group) => group.key)
      : grouping === "estado"
        ? statusGroups.map((group) => group.key)
        : null
  const allGroupsDescending =
    groupedKeys !== null &&
    groupedKeys.length > 0 &&
    groupedKeys.every((key) => descendingGroups.has(key))
  const allGroupsExpanded =
    groupedKeys !== null &&
    groupedKeys.length > 0 &&
    groupedKeys.every((key) => expandedGroups.has(key))

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
        <div className="flex flex-col gap-2">
            {/*
             * Renglón 1: las vistas preconfiguradas, los filtros guardados de
             * la cuenta y el botón «+» que abre el bottom sheet de creación,
             * en una sola fila desplazable en horizontal con el scrollbar
             * oculto. El `pr-10` reserva espacio al final del desplazamiento
             * para que el «+» quede fuera de la zona del chevron y no se
             * esconda debajo de él. En el margen derecho flota un chevron
             * gris, pista visual de que la fila continúa: al hover o tap
             * muestra el tooltip «deslizar» y el tap además recorre la fila
             * hasta el final (y de vuelta al inicio si ya está al final) para
             * demostrar que se puede deslizar.
             */}
            <div className="relative">
              <div
                ref={filterRowRef}
                role="toolbar"
                aria-label="Filtros de clientes"
                className="flex flex-nowrap items-center gap-2 overflow-x-auto pr-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
              >
                {/*
                 * Hilera de chips en su orden final (layout guardado del
                 * usuario o natural): vistas preconfiguradas y filtros
                 * guardados conviven y se reordenan entre sí con «Reordenar»
                 * (drag & drop). Las vistas mantienen su radio fijo.
                 */}
                {chips.map((chip) => {
                  if (chip.kind === "preset") {
                    return (
                      <Toggle
                        key={chip.key}
                        variant="outline"
                        size="sm"
                        pressed={!activeFilter && preset === chip.item.value}
                        onPressedChange={(next) => {
                          // Radio fijo: volver a pulsar la vista activa no
                          // la suelta. SELECCIÓN ÚNICA con los filtros
                          // guardados: elegir una vista suelta el filtro
                          // activo (se combinaban con AND y podían
                          // contradecirse — «Vencido» + «estado es Activo» =
                          // lista vacía—); «Todos» además deja el listado
                          // sin condiciones de ningún tipo.
                          if (!next) return
                          setPreset(chip.item.value)
                          applySavedFilter(null)
                        }}
                        aria-label={`Vista ${chip.item.label}`}
                        className={`rounded-full ${PRESET_ACTIVE_CLASS}`}
                      >
                        {chip.item.label}
                        <Badge
                          variant="outline"
                          size="xs"
                          className={PRESET_COUNT_CLASS}
                        >
                          {presetCounts[chip.item.value]}
                        </Badge>
                      </Toggle>
                    )
                  }
                  const filter = chip.filter
                  const isActive = activeFilterId === filter.id
                  return (
                  <span
                    key={chip.key}
                    /*
                     * BOTÓN PARTIDO: una sola cápsula donde la mitad izquierda
                     * aplica el filtro y la derecha (settings-2, separada por
                     * un divisor) abre su menú Editar/Borrar. El borde y el
                     * fondo son del contenedor — nunca de los botones — para
                     * que se lea como UN control y las opciones se entiendan
                     * como de ESE filtro, no de todos. Invertido cuando está
                     * activo (fondo foreground), igual que las vistas.
                     */
                    className={`flex shrink-0 items-center overflow-hidden rounded-full border transition-colors ${
                      isActive
                        ? "border-foreground bg-foreground text-background"
                        : "border-input bg-background"
                    }`}
                  >
                    <Toggle
                      variant="default"
                      size="sm"
                      pressed={isActive}
                      onPressedChange={(next) => {
                        applySavedFilter(next ? filter : null)
                      }}
                      aria-label={`Aplicar el filtro ${filter.name}`}
                      className="rounded-none border-0 bg-transparent hover:bg-transparent hover:text-inherit aria-pressed:bg-transparent aria-pressed:text-inherit data-[state=on]:bg-transparent"
                    >
                      {filter.name}
                      <Badge
                        variant="outline"
                        size="xs"
                        className={PRESET_COUNT_CLASS}
                      >
                        {savedFilterCounts.get(filter.id) ?? 0}
                      </Badge>
                    </Toggle>
                    {/*
                     * Mitad derecha del botón partido: settings-2 abre el
                     * menú (mismo patrón que el menú de acciones de /users)
                     * con Editar (reabre el bottom sheet precargado, PATCH) y
                     * Borrar (con confirmación). Vive FUERA del Toggle para
                     * no anidar botones; el divisor marca la frontera de los
                     * dos gestos dentro de la misma cápsula.
                     */}
                    <span
                      aria-hidden="true"
                      className={`h-4 w-px shrink-0 ${
                        isActive ? "bg-background/40" : "bg-border"
                      }`}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Opciones del filtro ${filter.name}`}
                            className={`size-7 shrink-0 rounded-none ${
                              isActive
                                ? "text-background hover:bg-background/15 hover:text-background"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          />
                        }
                      >
                        <Settings2Icon aria-hidden="true" className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {/*
                         * Reordenar: abre el bottom sheet con la lista
                         * arrastrable (drag & drop) de TODA la hilera:
                         * vistas y filtros.
                         */}
                        <DropdownMenuItem
                          onClick={() => setReorderOpen(true)}
                        >
                          <ArrowUpDownIcon aria-hidden="true" />
                          <span>Reordenar</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openEditFilter(filter)}
                        >
                          <PencilIcon aria-hidden="true" />
                          <span>Editar</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(filter)}
                        >
                          <Trash2Icon aria-hidden="true" />
                          <span>Borrar</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                  )
                })}
                {/*
                 * «+»: abre el bottom sheet de creación de filtros compuestos
                 * (nombre + stack de reglas + agrupar por) que se guardan en
                 * la cuenta del usuario.
                 */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Crear filtro"
                  onClick={openBuilder}
                  className="size-7 shrink-0 rounded-full bg-foreground p-0 text-background hover:bg-foreground/80 [&_svg:not([class*='size-'])]:size-4"
                >
                  <PlusIcon aria-hidden="true" />
                </Button>
              </div>
              {/*
               * Pista de deslizamiento: chevron gris flotante sobre el borde
               * derecho del renglón. Sin fondo, sin borde y sin hover de
               * pulsación: solo sugiere que hay más contenido a la derecha y
               * despliega el tooltip «deslizar» al hover o tap. El tap TAMBIÉN
               * recorre la fila hasta el final (demostración del gesto; con
               * `prefers-reduced-motion` el salto es instantáneo) y si ya está
               * al final regresa al inicio. El Tooltip es controlado porque el
               * hover de Base UI es solo-mouse: el `onPointerDown` del trigger
               * abre en el tap táctil y el toque fuera (dismiss) lo cierra. La
               * capa es `pointer-events-none` y solo el chevron recibe toques,
               * así el resto de la fila sigue desplazándose con el gesto.
               */}
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center">
                <Tooltip
                  open={swipeHintOpen}
                  onOpenChange={setSwipeHintOpen}
                >
                  <TooltipTrigger
                    closeOnClick={false}
                    render={
                      <button
                        type="button"
                        aria-label="Más filtros hacia la derecha"
                        onPointerDown={runSwipeHint}
                        className="pointer-events-auto flex h-full cursor-default items-center bg-gradient-to-l from-background via-background/70 to-transparent pr-0.5 pl-5 text-muted-foreground/60"
                      />
                    }
                  >
                    <ChevronRightIcon aria-hidden="true" className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>deslizar</TooltipContent>
                </Tooltip>
              </div>
            </div>
            {/*
             * Renglón 2: las reglas del filtro guardado activo, como píldoras
             * de solo lectura con su conteo en cascada (la primera regla
             * cuenta sobre el listado completo y cada siguiente sobre el
             * resultado de la anterior). Editar es crear un filtro nuevo; el
             * contenedor envuelve (`flex-wrap`) y la pila crece hacia abajo.
             */}
            {activeFilter && activeFilter.rules.length > 0 ? (
              <div
                role="group"
                aria-label={`Reglas del filtro ${activeFilter.name}`}
                className="flex flex-wrap items-center gap-2"
              >
                {activeFilter.rules.map((rule, index) => (
                  <span
                    key={`${rule.field}-${index}`}
                    className="flex shrink-0 items-center gap-1.5"
                  >
                    <span className="inline-flex items-center rounded-full border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
                      {clientFilterRuleText(rule)}
                    </span>
                    <Badge
                      variant="outline"
                      size="xl"
                      className="rounded-full px-3 tabular-nums"
                    >
                      {activeRuleCounts[index] ?? 0}
                    </Badge>
                  </span>
                ))}
              </div>
            ) : null}
            </div>
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
        <>
          {/*
           * Barra global sobre el listado (margen derecho): en modo agrupado
           * ordena TODAS las secciones y expande/colapsa todas; en modo plano
           * (vistas y filtros sin «Agrupar por») muestra solo el botón de
           * orden, el mismo control A→Z ↔ Z→A de las secciones. El icono
           * muestra la acción a ejecutar según el estado del conjunto;
           * size-8 por el área táctil móvil.
           */}
          {groupedKeys ? (
            <div className="flex items-center justify-end gap-1 px-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-full hover:bg-muted"
                aria-label={
                  allGroupsDescending
                    ? "Ordenar todos los grupos en ascendente"
                    : "Ordenar todos los grupos en descendente"
                }
                onClick={() =>
                  setDescendingGroups(
                    allGroupsDescending
                      ? new Set()
                      : new Set(groupedKeys)
                  )
                }
              >
                {allGroupsDescending ? (
                  <ArrowDownAZIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ArrowUpAZIcon aria-hidden="true" className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-full hover:bg-muted"
                aria-label={
                  allGroupsExpanded
                    ? "Colapsar todos los grupos"
                    : "Expandir todos los grupos"
                }
                onClick={() =>
                  setExpandedGroups(
                    allGroupsExpanded ? new Set() : new Set(groupedKeys)
                  )
                }
              >
                {allGroupsExpanded ? (
                  <ChevronsDownUpIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ChevronsUpDownIcon aria-hidden="true" className="size-4" />
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end px-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-full hover:bg-muted"
                aria-pressed={flatDescending}
                aria-label={
                  flatDescending
                    ? "Ordenar clientes en ascendente"
                    : "Ordenar clientes en descendente"
                }
                onClick={() => setFlatDescending((previous) => !previous)}
              >
                {flatDescending ? (
                  <ArrowDownAZIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ArrowUpAZIcon aria-hidden="true" className="size-4" />
                )}
              </Button>
            </div>
          )}
          <Accordion multiple={false}>
            {/*
             * En modo agrupado cada sección es un acordeón colapsable propio
             * (cerrado por defecto) con sus filas dentro; en modo plano las
             * filas van directamente. Las filas conservan la key y el tipo
             * que ya tenían, así que alternar la agrupación solo monta los
             * encabezados y reutiliza las filas vivas.
             */}
            {grouping === "socio"
              ? socioGroups.map(renderGroup)
              : grouping === "estado"
                ? statusGroups.map(renderGroup)
                : sortedFlat.map(renderClientItem)}
          </Accordion>
        </>
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
       * Bottom sheet de creación/edición de filtros compuestos (mismo Drawer
       * del pago, borde inferior con asa). Un filtro guardado = nombre + stack
       * de reglas (todas se cumplen a la vez) + modo de agrupación opcional
       * («Agrupar por» socio/estado); se guarda en la cuenta del usuario vía
       * POST /api/clientes/filters (creación) o PATCH
       * /api/clientes/filters/{id} (edición, abierta desde el menú settings-2
       * del chip) y al guardar queda aplicado. El botón primario vive en el
       * pie y solo se habilita con el borrador válido; la vista previa en
       * vivo dice cuántos clientes coinciden antes de decidir. Mientras
       * guarda no se cierra (Escape y swipe bloqueados).
       */}
      <Drawer
        open={builderOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeBuilder()
            return
          }
          setBuilderOpen(open)
        }}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {editingFilterId ? "Editar filtro" : "Crear filtro"}
            </DrawerTitle>
            <DrawerDescription>
              {editingFilterId
                ? "Ajusta el nombre, las reglas o la agrupación; los cambios se guardan en tu cuenta."
                : "Nómbralo, arma el stack de reglas y elige si agrupar. Se guarda en tu cuenta y queda a un toque en la barra."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-2">
            {/*
             * Nombre: lo único obligatorio. El contador de caracteres solo
             * aparece cerca del tope; el duplicado se valida contra la lista
             * cargada (el servidor vuelve a validar con 409).
             */}
            <Field>
              <FieldLabel htmlFor="client-filter-name">Nombre</FieldLabel>
              <Input
                id="client-filter-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={CLIENT_FILTER_NAME_MAX}
                placeholder="Ej. Urgencias de mis socios"
                aria-invalid={draftNameDuplicated || undefined}
              />
              {draftNameDuplicated ? (
                <FieldDescription className="text-destructive">
                  Ya tienes un filtro con ese nombre.
                </FieldDescription>
              ) : draftNameTrim.length > CLIENT_FILTER_NAME_MAX - 10 ? (
                <FieldDescription>
                  {CLIENT_FILTER_NAME_MAX - draftNameTrim.length} caracteres
                  restantes.
                </FieldDescription>
              ) : null}
            </Field>
            {/*
             * Stack de reglas: cada regla es una tarjeta con campo, operador
             * y valor; todas se cumplen a la vez (AND). Sin reglas el filtro
             * solo agrupa (si eligió agrupación).
             */}
            <Field>
              <FieldLabel>Reglas</FieldLabel>
              <FieldDescription>
                El filtro muestra los clientes que cumplen todas las reglas.
              </FieldDescription>
              <div className="flex flex-col gap-2">
                {draftRules.map((rule, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-lg border p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={rule.field}
                        items={CLIENT_FILTER_FIELD_ITEMS}
                        onValueChange={(value) => {
                          if (
                            value === "estado" ||
                            value === "reseller" ||
                            value === "dias"
                          ) {
                            changeDraftRuleField(index, value)
                          }
                        }}
                      >
                        <SelectTrigger
                          className="flex-1"
                          aria-label={`Campo de la regla ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="estado">Estado</SelectItem>
                          {isAdmin ? (
                            <SelectItem value="reseller">Distribuidor</SelectItem>
                          ) : null}
                          <SelectItem value="dias">Días para vencer</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeDraftRule(index)}
                        aria-label={`Quitar la regla ${index + 1}`}
                        className="text-muted-foreground size-8 shrink-0 rounded-full hover:text-destructive"
                      >
                        <XIcon aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={rule.operator}
                        items={CLIENT_FILTER_OPERATORS[rule.field]}
                        onValueChange={(value) => {
                          if (value) updateDraftRule(index, { operator: value })
                        }}
                      >
                        <SelectTrigger
                          className="flex-1"
                          aria-label={`Condición de la regla ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CLIENT_FILTER_OPERATORS[rule.field].map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/*
                       * Valor: selector por campo (con el conteo como
                       * subtítulo) o número de días; el operador «está
                       * vacío» no lleva valor.
                       */}
                      {rule.field === "estado" ? (
                        <Select
                          value={
                            rule.value === null ? null : String(rule.value)
                          }
                          items={CLIENT_FILTER_ESTADO_ITEMS}
                          onValueChange={(value) => {
                            if (value) updateDraftRule(index, { value })
                          }}
                        >
                          <SelectTrigger
                            className="flex-1"
                            aria-label={`Valor de la regla ${index + 1}`}
                          >
                            <SelectValue placeholder="Elige" />
                          </SelectTrigger>
                          <SelectContent>
                            {CLIENT_FILTER_ESTADO_VALUES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {clientEstadoLabel(value)}
                                <span className="text-muted-foreground text-xs">
                                  {estadoCounts.get(value) ?? 0}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : rule.field === "reseller" ? (
                        <Select
                          value={
                            rule.value === null || rule.value === ""
                              ? rule.value === ""
                                ? SIN_DISTRIBUIDOR_OPTION
                                : null
                              : String(rule.value)
                          }
                          items={resellerOptions}
                          onValueChange={(value) => {
                            if (value === null) return
                            updateDraftRule(index, {
                              value:
                                value === SIN_DISTRIBUIDOR_OPTION
                                  ? ""
                                  : value,
                            })
                          }}
                        >
                          <SelectTrigger
                            className="flex-1"
                            aria-label={`Valor de la regla ${index + 1}`}
                          >
                            <SelectValue placeholder="Elige" />
                          </SelectTrigger>
                          <SelectContent>
                            {resellerOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                                <span className="text-muted-foreground text-xs">
                                  {option.description}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : rule.operator === "empty" ? null : (
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={
                            rule.value === null || rule.value === ""
                              ? ""
                              : String(rule.value)
                          }
                          onChange={(event) =>
                            updateDraftRule(index, {
                              value:
                                event.target.value === ""
                                  ? null
                                  : event.target.value,
                            })
                          }
                          placeholder="Días"
                          aria-label={`Valor de la regla ${index + 1}`}
                          className="h-8 flex-1"
                        />
                      )}
                    </div>
                  </div>
                ))}
                {draftRules.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Sin reglas el filtro solo agrupa el listado.
                  </p>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addDraftRule}
                  disabled={draftRules.length >= CLIENT_FILTER_MAX_RULES}
                  className="self-start rounded-full"
                >
                  <PlusIcon aria-hidden="true" />
                  Añadir regla
                </Button>
              </div>
            </Field>
            {/*
             * Agrupar por: las mismas filas-tarjeta del selector de método de
             * pago (radio al final, descripción de una línea). «Socio» solo
             * para admin; sin las reglas compuestas del chip rápido: este
             * agrupador agrupa y punto.
             */}
            <Field>
              <FieldLabel>Agrupar por</FieldLabel>
              <RadioGroup
                value={draftGroupBy}
                onValueChange={(value) =>
                  setDraftGroupBy(value as ClientFilterGroupBy)
                }
                aria-label="Agrupar por"
              >
                <FieldGroup className="gap-0">
                  <Field>
                    <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FieldContent className="min-w-0">
                          <FieldTitle>Ninguno</FieldTitle>
                          <FieldDescription className="text-xs">
                            Lista plana, sin secciones
                          </FieldDescription>
                        </FieldContent>
                      </span>
                      <RadioGroupItem value="ninguno" />
                    </FieldLabel>
                  </Field>
                  <Separator />
                  <Field>
                    <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FieldContent className="min-w-0">
                          <FieldTitle>Estado</FieldTitle>
                          <FieldDescription className="text-xs">
                            Secciones «Activo» e «Inactivo»
                          </FieldDescription>
                        </FieldContent>
                      </span>
                      <RadioGroupItem value="estado" />
                    </FieldLabel>
                  </Field>
                  {isAdmin ? (
                    <>
                      <Separator />
                      <Field>
                        <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <FieldContent className="min-w-0">
                              <FieldTitle>Socio</FieldTitle>
                              <FieldDescription className="text-xs">
                                Una sección por distribuidor asignado
                              </FieldDescription>
                            </FieldContent>
                          </span>
                          <RadioGroupItem value="socio" />
                        </FieldLabel>
                      </Field>
                    </>
                  ) : null}
                </FieldGroup>
              </RadioGroup>
            </Field>
            {/*
             * Vista previa en vivo sobre el listado cargado: feedback
             * inmediato antes de decidir (siempre visible, con o sin reglas).
             */}
            <p
              className="text-muted-foreground text-xs"
              role="status"
              aria-live="polite"
            >
              Coinciden {draftPreview} de {clients.length} clientes
            </p>
          </div>
          <DrawerFooter>
            <DrawerClose
              render={
                <Button variant="ghost" onClick={closeBuilder}>
                  Cancelar
                </Button>
              }
            />
            <Button
              onClick={() => void saveDraftFilter()}
              disabled={!draftValid || savingFilter}
            >
              {savingFilter ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              {editingFilterId ? "Guardar cambios" : "Guardar filtro"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/*
       * Ventana flotante «Reordenar» (menú settings-2 del chip): la HILERA
       * COMPLETA de chips (vistas preconfiguradas + filtros guardados) con
       * drag & drop (dnd-kit). Es un Dialog y NO un bottom sheet a propósito:
       * el gesto de swipe del sheet se peleaba con el arrastre de las filas
       * y movía el panel. Superficie fija, X de cierre arriba a la derecha
       * (incluida en DialogContent), Escape y toque fuera también cierran.
       * Cada drop persiste el orden de claves en la cuenta vía PUT
       * /api/clientes/chips de forma optimista; sin botón de guardar.
       */}
      <Dialog open={reorderOpen} onOpenChange={setReorderOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reordenar filtros</DialogTitle>
            <DialogDescription>
              Arrastra las vistas y los filtros con el asa para cambiar el
              orden de la hilera; el primero queda en el margen izquierdo. El
              orden se guarda en tu cuenta al soltar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto pr-0.5">
            <DndContext
              sensors={reorderSensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={(event) => void handleReorderDragEnd(event)}
            >
              <SortableContext
                items={chips.map((chip) => chip.key)}
                strategy={verticalListSortingStrategy}
              >
                {chips.map((chip, index) => (
                  <SortableChipRow key={chip.key} chip={chip} index={index} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <DialogFooter>
            <DialogClose render={<Button className="w-full sm:w-auto">Listo</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
       * Confirmación de borrado de un filtro guardado: destructiva, con el
       * nombre del filtro y la consecuencia (si estaba activo, la vista
       * vuelve a «Todos»).
       */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingFilter) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar el filtro «{deleteTarget?.name}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se quita de tu cuenta. Si estaba activo, el listado vuelve a la
              vista «Todos».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFilter}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void runDeleteFilter()
              }}
              disabled={deletingFilter}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletingFilter ? "Eliminando…" : "Eliminar"}
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
          // Al cerrar se descarta la sesión: la selección de método vuelve a
          // null (la lista abre sin default) y el concepto de transferencia
          // se descarta (pudo anularse o vencer; se re-consulta al volver).
          if (!open) {
            conceptRequestedKey.current = ""
            setTransferConcept(null)
            setConceptError(null)
            setConceptCopied(false)
            setTransferStep("concepto")
            setPayMethod(null)
          }
          setPurchaseOpen(open)
        }}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Renovar licencia</DrawerTitle>
            <DrawerDescription>
              {payMethod === "mercadopago"
                ? "Desglose del pago con Mercado Pago."
                : payMethod === "transferencia"
                  ? "Pago por transferencia bancaria."
                  : payMethod === "cupon"
                    ? "Canje con cupón."
                    : "Elige cómo pagar."}
            </DrawerDescription>
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
                {!mpBreakdown ? (
                  <span className="text-lg font-semibold tabular-nums">
                    {priceMxn !== null ? formatMxn(priceMxn) : "—"}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/*
             * Mercado Pago: pantalla propia — la lista desaparece y solo
             * queda el desglose del cargo. El total es el precio engrosado
             * (`mpTotalMxn`): la comisión (3.49% + $4) y su IVA se
             * descuentan del precio final de venta, así que cobrar el precio
             * neto depositaría menos; engrosado, el depósito neto es
             * exactamente el costo de licencia y el webhook verifica la
             * orden contra ese mismo total.
             */}
            {payMethod === "mercadopago" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Concepto (costo de licencia)
                    </span>
                    <span className="font-medium tabular-nums">
                      {priceMxn !== null ? formatMxn(priceMxn) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Costo por procesamiento
                    </span>
                    <span className="font-medium tabular-nums">
                      {priceMxn !== null
                        ? formatMxn(mpProcessingFeeMxn(priceMxn))
                        : "—"}
                    </span>
                  </div>
                </div>
                 <Separator />
                 <div className="flex items-center justify-between gap-2">
                   <span className="text-sm font-medium">Total</span>
                   <span className="text-lg font-semibold tabular-nums">
                     {priceMxn !== null ? formatMxn(mpTotalMxn(priceMxn)) : "—"}
                   </span>
                 </div>
               </div>
             ) : payMethod === null ? (
             /*
              * Selector de método: filas-tarjeta con radio al final; sin
              * selección por defecto. Tocar una fila abre directamente la
              * pantalla de ese método (no hay botón «Continuar»). La
              * transferencia solo se ofrece si el servidor tiene los datos
              * bancarios configurados; el cupón solo con el modo QA activado
              * (`COUPON_QA_ENABLED=1`).
              */
             <RadioGroup
               value={payMethod ?? ""}
               onValueChange={(value) => {
                 // Respaldo por si el clic llega directo al radio (el
                 // onClick de la fila es el camino principal): fijar el
                 // método abre su pantalla, la lista desaparece.
                 setPayMethod(value as PayMethod)
                 setPayError(null)
                 setTransferRejected(null)
                 // Volver a entrar a transferencia abre el flujo en el paso 1
                 // (el concepto vigente reaparece sin otra llamada).
                 if (value === "transferencia") setTransferStep("concepto")
               }}
               aria-label="Método de pago"
             >
              <FieldGroup className="gap-0">
                <Field>
                  {/*
                   * Tocar la fila abre la pantalla del método directamente:
                   * fija el método explícitamente sin depender del reenvío
                   * del label al radio (el valor controlado puede no cambiar
                   * y onValueChange no dispararse).
                   */}
                  <FieldLabel
                    className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5"
                    onClick={() => {
                      setPayMethod("mercadopago")
                      setPayError(null)
                      setTransferRejected(null)
                    }}
                  >
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
                      <FieldLabel
                        className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5"
                        onClick={() => {
                          setPayMethod("transferencia")
                          setTransferStep("concepto")
                          setPayError(null)
                          setTransferRejected(null)
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <LandmarkIcon
                            aria-hidden="true"
                            className="size-4 shrink-0 opacity-60"
                          />
                          <FieldContent className="min-w-0">
                            <FieldTitle>Transferencia</FieldTitle>
                            <FieldDescription className="text-xs">
                              Concepto de pago + comprobante · verificación
                              automática
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
                      <FieldLabel
                        className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5"
                        onClick={() => {
                          setPayMethod("cupon")
                          setPayError(null)
                          setTransferRejected(null)
                        }}
                      >
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
            ) : null}

            {/*
             * Panel de la transferencia (pantalla limpia): flujo de DOS
             * pasos. Paso 1: datos bancarios y el concepto de pago (código
             * de 4 caracteres) que el comprador escribe en su transferencia.
             * Paso 2: el ticket a subir, validado por el servidor contra ese
             * concepto. Pantalla propia de la transferencia: la lista de
             * métodos ya no está a la vista.
             */}
            {transferBank && payMethod === "transferencia" ? (
              transferStep === "concepto" ? (
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
                   * Concepto de pago (paso 1): código único del comprador +
                   * usuario durante el mes actual. El comprador lo escribe
                   * en su transferencia y el comprobante debe traerlo
                   * impreso para pasar la verificación automática.
                   */}
                  <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-xs">
                        <HashIcon aria-hidden="true" className="size-3.5 opacity-60" />
                        Concepto de pago
                      </span>
                      <Badge variant="outline" size="xs">
                        Vigente · {formatCurrentMonth()}
                      </Badge>
                    </div>
                    {loadingConcept ? (
                      <Skeleton className="h-9 w-40" aria-hidden="true" />
                    ) : transferConcept ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-2xl font-semibold tracking-[0.35em] tabular-nums">
                          {transferConcept.code}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={copyConcept}
                          aria-label="Copiar el concepto de pago"
                        >
                          {conceptCopied ? (
                            <CheckIcon aria-hidden="true" />
                          ) : (
                            <CopyIcon aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-destructive text-xs">
                          {conceptError ?? "No se pudo generar el concepto."}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            if (!purchaseTarget) return
                            void loadTransferConcept(
                              purchaseTarget.userName.trim()
                            )
                          }}
                        >
                          Reintentar
                        </Button>
                      </div>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Escribe este código como concepto de tu transferencia:
                      con él identificamos tu pago y validamos tu
                      comprobante.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {/*
                   * Paso 2: recordatorio del concepto y subida del
                   * comprobante; «Ver datos» regresa al paso 1.
                   */}
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-muted-foreground text-xs">
                        Concepto de pago
                      </span>
                      <span className="truncate font-mono text-sm font-semibold tracking-[0.2em] tabular-nums">
                        {transferConcept?.code ?? "—"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTransferStep("concepto")}
                    >
                      Ver datos de pago
                    </Button>
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
                      Subir comprobante
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
               )
             ) : null}

             {/*
              * Pantalla propia del cupón: la lista de métodos desaparece y
              * queda el canje. Código de 4 dígitos con InputOTP (un dígito
              * por celda); el servidor valida el código contra los cupones
              * activos al aplicar y renueva al instante; un código inválido
              * avisa con el Alert de error compartido de abajo.
              */}
             {payMethod === "cupon" ? (
               <div className="flex flex-col gap-3">
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
                 <p className="text-muted-foreground text-center text-xs">
                   El cupón se valida en el servidor y la renovación se aplica
                   al instante.
                 </p>
               </div>
              ) : null}

             {/*
              * Volver a la lista de métodos desde la pantalla del método
              * activo (Mercado Pago o cupón): limpia la selección para que
              * la lista abra sin default. En la transferencia no existe: al
              * llegar a esa pantalla el comprador ya hizo la transferencia,
              * así que cambiar de método ya no aplica.
              */}
             {payMethod === "mercadopago" || payMethod === "cupon" ? (
               <div className="flex justify-center pt-1">
                 <Button
                   type="button"
                   variant="ghost"
                   size="sm"
                   onClick={() => {
                     setPayMethod(null)
                     setPayError(null)
                     setTransferRejected(null)
                     setTransferStep("concepto")
                   }}
                   disabled={purchasing || submittingCoupon}
                 >
                   Cambiar método de pago
                 </Button>
               </div>
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
              /* Pantalla de transferencia: primarios del flujo de dos pasos. */
              transferStep === "concepto" ? (
                /* Paso 1 → 2: el comprador confirma que ya hizo la transferencia. */
                <Button
                  size="lg"
                  onClick={() => setTransferStep("comprobante")}
                  disabled={loadingConcept || transferConcept === null}
                >
                  {loadingConcept ? (
                    <>
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className="animate-spin"
                      />
                      Generando concepto…
                    </>
                  ) : (
                    "Ya hice la transferencia"
                  )}
                </Button>
              ) : (
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
              )
            ) : payMethod === "mercadopago" ? (
              /* Pantalla de Mercado Pago: el primario abre el checkout. */
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
            ) : null}
            {/* Lista sin selección: solo Cancelar; el primario aparece al
                entrar a la pantalla del método elegido. */}
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
                      "Verificación automática: fecha del mes, concepto de pago (código), importe y beneficiario.",
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
