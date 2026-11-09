"use client"

/**
 * Módulo «Paquetes FlujoTV» (`/modulos/paquetes-flujotv`): compra de
 * renovaciones en paquete (3, 6 y 12 meses) con la misma estructura de la
 * compra de licencias individuales de `/clientes`:
 *
 * - Listado de clientes del panel (mismas filas de `/clientes`: avatar con
 *   iniciales, nombre propio según Notas, barra de progreso con días
 *   restantes y punto de estado) con búsqueda por usuario, nombre o correo.
 * - Botón de compra rápida por fila (shopping-cart-plus de lucide, misma
 *   posición y feedback de pulsación) que abre el bottom sheet de compra
 *   (Drawer de Base UI con asa de arrastre).
 * - El sheet compone el selector de **paquete** (RadioGroup: 3 meses sin
 *   regalo, 6 meses + 1 gratis, 12 meses + 2 gratis; el precio de la derecha
 *   es el de los meses pagados) y el **método de pago** (Mercado Pago,
 *   transferencia bancaria y cupón):
 *
 *   - **Mercado Pago**: `POST /api/paquetes/mercadopago` crea la orden
 *     `pending` con los meses del paquete congelados y redirige al
 *     `init_point`; el webhook verifica el pago y renueva aplicando el
 *     paquete completo (meses pagados + gratis). El retorno vuelve al módulo
 *     (`?orden=…&estado=…`) y el aviso sondea `GET /api/mercadopago/orders/{id}`
 *     cada 2 s hasta ver la renovación aplicada.
 *   - **Transferencia**: mismos datos bancarios y ticket que `/clientes`;
 *     `POST /api/paquetes/transferencias` deja la orden `pending` y la
 *     renovación llega cuando el admin aprueba la revisión (la sección de
 *     revisión de `/clientes` la lista junto a las individuales).
 *   - **Cupón**: el código está **asignado** por el sistema (`1010`, único
 *     código válido para cualquiera de los paquetes): no se teclea, se
 *     muestra y el servidor lo valida. `POST /api/paquetes/cupones` crea la
 *     orden pagada y renueva al instante, idempotente por request_id.
 *
 * - Tras una renovación confirmada la fila se refresca con la lectura en
 *   vivo del panel (`GET /api/flujotv/clients/{usuario}`), como en
 *   `/clientes`. El dato del listado viene de `GET /api/flujotv/clients`
 *   (con alcance de distribuidor ya filtrado en el servidor) y el evento en
 *   tiempo real `mp_order` refresca solo la fila del usuario renovado (el
 *   evento viaja con el usuario y el estado nuevo): sin recargar el listado
 *   completo, que es lento y traería el snapshot cacheado con el vencimiento
 *   viejo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckIcon,
  CircleCheckIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  TicketPercentIcon,
  TriangleAlertIcon,
  UploadIcon,
  WalletIcon,
  XIcon,
  ShoppingCartPlusIcon,
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
import { formatMxn } from "@/lib/finanzas"
import {
  formatFlujoDate,
  type FlujoClient,
} from "@/lib/flujotv"
import {
  PAQUETES,
  PAQUETE_COUPON_CODE,
  paqueteLabel,
  paqueteOrderLabel,
  paqueteTotalMonths,
  type PaqueteMonths,
} from "@/lib/paquetes"

import {
  fetchFlujoClient,
  fetchFlujoClients,
  refreshFlujo,
} from "@/components/lab/flujo-api"
import {
  fetchPaymentOrder,
  retryOrderRenewal,
  PagoRequestError,
  createPaqueteCouponOrder,
  createPaquetePaymentOrder,
  createPaqueteTransferOrder,
  type PaymentOrder,
} from "./paquetes-api"

type FetchState = "loading" | "success" | "error"

/** Métodos de pago del bottom sheet de paquetes. */
type PayMethod = "mercadopago" | "transferencia" | "cupon"

/** Tamaño máximo del ticket de transferencia (igual que el servidor). */
const TICKET_MAX_BYTES = 10 * 1024 * 1024

/** Ruta del módulo: retorno del checkout y limpieza de la query. */
const MODULO_PATH = "/modulos/paquetes-flujotv"

/**
 * Ventana de sondeo de la renovación desacoplada de un canje de cupón:
 * ~2 min a razón de 2 s por intento. Al agotarse, el canje sigue registrado
 * y la renovación sigue viva en el servidor (la conciliación de `paid` varado
 * la retoma a los 10 minutos); volver a pulsar «Aplicar cupón» consulta de
 * nuevo la misma orden sin crear otra.
 */
const COUPON_POLL_ATTEMPTS = 60
const COUPON_POLL_INTERVAL_MS = 2000

/** Segmento de confirmación con el vencimiento nuevo verificado en el panel
 * (null = sin lectura verificada).
 */
function verifiedExpiresSuffix(expiresAt: string | null): string {
  return expiresAt ? ` · nuevo vencimiento: ${formatFlujoDate(expiresAt)}` : ""
}

/** Etiqueta del plazo de una orden (meses pagados + gratis). */
function orderPaqueteLabel(order: PaymentOrder): string {
  return paqueteOrderLabel(order.months, order.bonus_months ?? 0)
}

/** Iniciales del avatar a partir del nombre de usuario. */
function initials(userName: string): string {
  const parts = userName.trim().split(/[\s._-]+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? ""
  const second = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? ""
  return (first + second).toUpperCase()
}

/** Ventana de urgencia: la barra se agota los 30 días previos al vencimiento. */
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
 * Nombre propio del cliente según la columna Notas del panel (mapa usuario
 * en minúsculas → nombre que trae el listado); vacío si no hay nombre.
 */
function clientName(
  client: FlujoClient,
  names: Record<string, string>
): string {
  return names[client.userName.trim().toLowerCase()] ?? ""
}

/**
 * Normaliza para comparar textos: minúsculas y sin acentos, igual que la
 * búsqueda de `/clientes` («cambron» encuentra «Cambrón»).
 */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Aviso de retorno del checkout de Mercado Pago (mismas reglas que
 * `/clientes`; el estado de display se DERIVA del sondeo).
 */
type PollStatus =
  | "renewed"
  | "renewal_failed"
  | "rejected"
  | "pending"

interface PaquetesViewProps {
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
}

export function PaquetesView({
  distribuidorName = null,
  priceMxn = null,
  returnOrder = null,
  returnState = null,
  transferBank = null,
}: PaquetesViewProps) {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [reloadCount, setReloadCount] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseTarget, setPurchaseTarget] = useState<FlujoClient | null>(null)
  /** Paquete elegido en el sheet: el de 3 meses por defecto. */
  const [paqueteMonths, setPaqueteMonths] = useState<PaqueteMonths>(3)
  const [purchasing, setPurchasing] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  /** Método elegido en el sheet: Mercado Pago por defecto. */
  const [payMethod, setPayMethod] = useState<PayMethod>("mercadopago")
  const [submittingTransfer, setSubmittingTransfer] = useState(false)
  const [submittingCoupon, setSubmittingCoupon] = useState(false)
  /**
   * Orden con renovación fallida pendiente de recuperación en este canje: el
   * botón principal pasa de «Aplicar cupón 1010» a «Reintentar renovación»
   * (sin nuevo canje ni nuevo cargo; la clave determinista evita duplicar
   * meses).
   */
  const [couponRetryOrderId, setCouponRetryOrderId] = useState<string | null>(
    null
  )
  /**
   * Orden con renovación EN CURSO en el servidor (canje de paquete): se
   * sondea hasta verla `renewed` o `renewal_failed`; mientras tanto el botón
   * principal muestra «Aplicando…» y el sheet no se cierra.
   */
  const [couponPollOrderId, setCouponPollOrderId] = useState<string | null>(
    null
  )
  /**
   * Id de la intención de canje vigente: se regenera al abrir el sheet y se
   * conserva entre reintentos del mismo intento, de modo que un reintento
   * tras una respuesta perdida devuelva la orden original (idempotente en el
   * servidor) en lugar de sumar otro paquete.
   */
  const couponRequestIdRef = useRef<string>("")
  const [accountCopied, setAccountCopied] = useState(false)
  const [pollResult, setPollResult] = useState<{
    status: PollStatus
    order: PaymentOrder | null
  } | null>(null)

  /**
   * Ticket de la transferencia: un solo archivo (foto o PDF del comprobante),
   * validado en cliente como en el servidor (tipo y tamaño).
   */
  const [ticketFiles, ticketActions] = useFileUpload({
    accept: "image/*,application/pdf",
    multiple: false,
    maxSize: TICKET_MAX_BYTES,
  })

  const requestCounter = useRef(0)
  const router = useRouter()

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoClients({})
      .then((data) => {
        if (requestId !== requestCounter.current) return
        setClients(data.clients)
        setClientNames(data.clientNames ?? {})
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

  /** Sincronización real con el panel (~90 s), igual que en `/clientes`. */
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
      setPaqueteMonths(3)
      setPayMethod("mercadopago")
      setPayError(null)
      setCouponRetryOrderId(null)
      setCouponPollOrderId(null)
      couponRequestIdRef.current =
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      ticketActions.clearFiles()
      setPurchaseOpen(true)
    },
    [ticketActions]
  )

  /** Importe del paquete elegido: solo los meses pagados; los gratis no cobran. */
  const paqueteAmount =
    priceMxn !== null
      ? Math.round(priceMxn * paqueteMonths * 100) / 100
      : null

  const submitPurchase = useCallback(async () => {
    if (!purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    setPurchasing(true)
    setPayError(null)
    try {
      const order = await createPaquetePaymentOrder({
        userName,
        months: paqueteMonths,
      })
      // Redirección completa al checkout de Mercado Pago (wallet_purchase):
      // el pago ocurre fuera del panel y la renovación la aplica el webhook.
      window.location.assign(order.initPoint)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo iniciar el pago."
      setPayError(message)
      setPurchasing(false)
    }
  }, [purchaseTarget, paqueteMonths])

  /**
   * Envía la compra por transferencia bancaria: crea la orden `pending` con
   * el ticket adjunto y cierra el sheet. La renovación llega cuando el admin
   * aprueba la revisión; el evento en tiempo real refresca la fila.
   */
  const submitTransfer = useCallback(async () => {
    if (!purchaseTarget) return
    const ticket = ticketFiles.files[0]?.file
    if (!(ticket instanceof File)) return
    const userName = purchaseTarget.userName.trim()
    setSubmittingTransfer(true)
    setPayError(null)
    try {
      await createPaqueteTransferOrder({
        userName,
        months: paqueteMonths,
        file: ticket,
      })
      setPurchaseOpen(false)
      toast.success("Comprobante enviado", {
        description: `El paquete de ${userName} (${paqueteLabel(paqueteMonths)}) se aplicará en cuanto se confirme el pago.`,
      })
    } catch (error) {
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el comprobante."
      )
    } finally {
      setSubmittingTransfer(false)
    }
  }, [purchaseTarget, ticketFiles, paqueteMonths])

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
   * Las órdenes (incluidos los paquetes) NO recargan el listado: recargarlo
   * es lento y, peor, el listado viene del snapshot cacheado del panel —
   * presentaría el vencimiento VIEJO pisando la fecha nueva que la fila ya
   * mostraba. La fila de un cliente solo cambia cuando la renovación del
   * paquete se APLICÓ (`renewed`), y ese evento viaja con el usuario
   * renovado: se refresca SOLO su fila con la lectura en vivo del panel
   * (mismo mecanismo de `refreshRow` que usan los flujos de compra de esta
   * pestaña). Eventos sin renovación aplicada (`pending`, `paid` en curso,
   * rechazos, reembolsos, escaneo de comprobante) no mueven el vencimiento
   * de nadie: no tocan filas.
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
   * Canjea el cupón asignado (1010): el servidor valida el código contra el
   * paquete, registra la orden pagada y renueva con los meses gratis. Para
   * paquetes la renovación va DESACOPLADA (status `pending`) y este canje
   * pasa a sondear la orden; para el caso ya renovado cierra con el éxito.
   * El canje es idempotente por `couponRequestIdRef`: un reintento tras una
   * respuesta perdida devuelve la orden original en lugar de sumar otro
   * paquete.
   */
  const submitCoupon = useCallback(async () => {
    if (!purchaseTarget) return
    const userName = purchaseTarget.userName.trim()
    const requestId = couponRequestIdRef.current
    if (requestId.length === 0) return
    setSubmittingCoupon(true)
    setPayError(null)
    try {
      const result = await createPaqueteCouponOrder({
        userName,
        months: paqueteMonths,
        requestId,
      })
      // Etiqueta SIEMPRE desde la orden del servidor (meses pagados + gratis):
      // un replay con otra selección en pantalla anunciaría el paquete equivocado.
      const label = paqueteOrderLabel(result.months, result.bonusMonths)
      if (result.status === "renewal_failed") {
        // El canje quedó registrado pero la renovación no se confirmó contra
        // el panel: el botón principal pasa a reintentar la renovación (misma
        // orden, sin nuevo canje).
        setCouponRetryOrderId(result.orderId)
        setPayError(
          `El cupón se aceptó y quedó registrado (orden ${result.orderId.slice(0, 8)}…), pero la renovación no se confirmó en el panel de licencias.${result.error ? ` ${result.error}` : ""} Pulsa «Reintentar renovación»: no se vuelve a canjar ni suma meses extra.`
        )
        refreshRow(userName)
      } else if (result.status === "pending") {
        // Renovación en curso en el servidor: sondear la orden hasta verla
        // `renewed` o `renewal_failed`; el botón muestra «Aplicando…».
        setCouponPollOrderId(result.orderId)
      } else {
        setPurchaseOpen(false)
        toast.success("Renovación aplicada", {
          description: `${userName} · ${label} · ${formatMxn(result.amount)}${verifiedExpiresSuffix(result.verifiedExpiresAt)}`,
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
          ? `${detail} Puedes pulsar «Aplicar cupón ${PAQUETE_COUPON_CODE}» de nuevo: el canje no se duplica.`
          : detail
      )
    } finally {
      setSubmittingCoupon(false)
    }
  }, [purchaseTarget, paqueteMonths, refreshRow])

  /**
   * Sondeo de la renovación desacoplada de un canje de cupón: la orden parte
   * `paid` (el cupón ya quedó registrado) y el servidor aplica el plan del
   * paquete en segundo plano. `renewed` cierra con éxito; `renewal_failed`
   * activa el reintento seguro; al agotarse la ventana, el mensaje informa y
   * volver a pulsar «Aplicar cupón» consulta la misma orden (mismo
   * request_id) sin crear otra.
   */
  useEffect(() => {
    if (!couponPollOrderId) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const tick = async () => {
      attempts += 1
      let order: PaymentOrder | null = null
      try {
        order = await fetchPaymentOrder(couponPollOrderId)
      } catch {
        order = null
      }
      if (cancelled) return

      if (order) {
        const label = orderPaqueteLabel(order)
        if (order.status === "renewed") {
          setCouponPollOrderId(null)
          setPurchaseOpen(false)
          toast.success("Renovación aplicada", {
            description: `${order.user_name} · ${label} · ${formatMxn(order.amount)}${verifiedExpiresSuffix(order.renewal_verified_expires_at)}`,
          })
          refreshRow(order.user_name)
          return
        }
        if (order.status === "renewal_failed") {
          setCouponPollOrderId(null)
          setCouponRetryOrderId(order.id)
          setPayError(
            `El cupón se aceptó y quedó registrado (orden ${order.id.slice(0, 8)}…), pero la renovación no se confirmó en el panel de licencias.${order.error ? ` ${order.error}` : ""} Pulsa «Reintentar renovación»: no se vuelve a canjar ni suma meses extra.`
          )
          refreshRow(order.user_name)
          return
        }
      }

      if (attempts >= COUPON_POLL_ATTEMPTS) {
        setCouponPollOrderId(null)
        setPayError(
          "El cupón quedó registrado y la renovación sigue aplicándose en el panel de licencias. Espera un momento y vuelve a pulsar «Aplicar cupón»: se consulta la misma orden sin canjar ni sumar meses extra."
        )
        return
      }
      timer = setTimeout(() => {
        void tick()
      }, COUPON_POLL_INTERVAL_MS)
    }

    timer = setTimeout(() => {
      void tick()
    }, COUPON_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [couponPollOrderId, refreshRow])

  /**
   * Reintenta la renovación de la orden con renovación fallida de este
   * canje: sin nuevo cargo ni canje; la clave determinista de la orden evita
   * sumar meses dos veces. La etiqueta del éxito viene de la orden reintentada.
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
          description: `${userName} · ${paqueteOrderLabel(result.months, result.bonusMonths)}${verifiedExpiresSuffix(result.verifiedExpiresAt)}`,
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
   * por el back_url de fallo no se sondea: es definitiva y no hubo cargo.
   */
  useEffect(() => {
    if (!returnOrder || returnState === "rechazado") return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
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
            description: `${order.user_name} · ${orderPaqueteLabel(order)} · ${formatMxn(order.amount)}${verifiedExpiresSuffix(order.renewal_verified_expires_at)}`,
          })
          refreshRow(order.user_name)
          router.replace(MODULO_PATH)
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
   * resultado terminal del sondeo manda y DEBE sobrevivir a la limpieza de
   * la query (`router.replace` borra `returnOrder` pero `pollResult`
   * permanece), o el aviso de éxito se desmontaría al instante.
   */
  const returnStatus: "working" | PollStatus | null =
    pollResult?.status ??
    (!returnOrder
      ? null
      : returnState === "rechazado"
        ? "rejected"
        : "working")

  const filtered = useMemo(() => {
    const term = foldTerm(searchInput)
    if (!term) return clients
    return clients.filter(
      (client) =>
        foldTerm(client.userName).includes(term) ||
        foldTerm(client.email ?? "").includes(term) ||
        foldTerm(clientName(client, clientNames)).includes(term)
    )
  }, [clients, searchInput, clientNames])

  const searching = searchInput.trim().length > 0

  /**
   * Ocupado del sheet: además de los envíos, el sondeo de la renovación
   * desacoplada de un canje mantiene el botón en «Aplicando…» y el sheet
   * cerrado bajo llave (la orden ya quedó registrada; cerrar ahora dejaría
   * sin contexto el reintento).
   */
  const couponPolling = couponPollOrderId !== null
  const busy =
    purchasing || submittingTransfer || submittingCoupon || couponPolling

  return (
    <div className="flex flex-col gap-4">
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
                ? `${pollResult.order.user_name} · ${orderPaqueteLabel(pollResult.order)} · ${formatMxn(pollResult.order.amount)}${verifiedExpiresSuffix(pollResult.order.renewal_verified_expires_at)}`
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
          Ningún cliente coincide con la búsqueda.
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
                    disabled={busy}
                    aria-label={`Comprar paquete para ${client.userName}`}
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
          {searching
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
       * Bottom sheet de compra de paquetes (Drawer de Base UI, borde
       * inferior con asa de arrastre). Controlado: el botón de compra de la
       * fila fija el cliente objetivo y abre; Cancelar cierra vía
       * DrawerClose. Mientras se procesa el pago no se cierra ni con Escape
       * ni con swipe.
       */}
      <Drawer
        open={purchaseOpen}
        onOpenChange={(open) => {
          if (!open && busy) return
          setPurchaseOpen(open)
        }}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Comprar paquete FlujoTV</DrawerTitle>
            <DrawerDescription>
              Elige el paquete y cómo pagar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {/*
             * Resumen: a quién, qué paquete y por cuánto. El importe manda a
             * la derecha en grande; los meses gratis no cobran.
             */}
            {purchaseTarget ? (
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {purchaseTarget.userName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Paquete {paqueteLabel(paqueteMonths)} ·{" "}
                    {paqueteTotalMonths(paqueteMonths)} meses de servicio
                  </span>
                </div>
                <span className="text-lg font-semibold tabular-nums">
                  {paqueteAmount !== null ? formatMxn(paqueteAmount) : "—"}
                </span>
              </div>
            ) : null}

            {/*
             * Selector de paquete: filas-tarjeta con radio al final; la
             * elegida se resalta sola (has-data-checked del FieldLabel).
             * Cada fila muestra los meses de servicio que quedan aplicados
             * (pagados + gratis) y el importe a la derecha.
             */}
            <RadioGroup
              value={String(paqueteMonths)}
              onValueChange={(value) => {
                const next = Number(value)
                if (
                  PAQUETES.some((paquete) => paquete.months === next)
                ) {
                  setPaqueteMonths(next as PaqueteMonths)
                  setPayError(null)
                }
              }}
              aria-label="Paquete de renovación"
            >
              <FieldGroup className="gap-0">
                {PAQUETES.map((paquete, index) => {
                  const amount =
                    priceMxn !== null
                      ? Math.round(priceMxn * paquete.months * 100) / 100
                      : null
                  return (
                    <Field key={paquete.months}>
                      {index > 0 ? <Separator /> : null}
                      <FieldLabel className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <FieldContent className="min-w-0">
                            <FieldTitle>
                              {paqueteLabel(paquete.months)}
                            </FieldTitle>
                            <FieldDescription className="text-xs">
                              {paqueteTotalMonths(paquete.months)} meses de
                              servicio
                            </FieldDescription>
                          </FieldContent>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-medium tabular-nums">
                            {amount !== null ? formatMxn(amount) : "—"}
                          </span>
                          <RadioGroupItem value={String(paquete.months)} />
                        </span>
                      </FieldLabel>
                    </Field>
                  )
                })}
              </FieldGroup>
            </RadioGroup>

            {/*
             * Selector de método: filas-tarjeta con radio al final. La
             * transferencia solo se ofrece si el servidor tiene los datos
             * bancarios configurados; el cupón del módulo (1010) está
             * asignado por el sistema y se ofrece siempre.
             */}
            <RadioGroup
              value={payMethod}
              onValueChange={(value) => {
                setPayMethod(value as PayMethod)
                setPayError(null)
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
                              Sube tu comprobante · activación al confirmar
                            </FieldDescription>
                          </FieldContent>
                        </span>
                        <RadioGroupItem value="transferencia" />
                      </FieldLabel>
                    </Field>
                  </>
                ) : null}
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
                          Cupón {PAQUETE_COUPON_CODE} asignado · activación
                          inmediata
                        </FieldDescription>
                      </FieldContent>
                    </span>
                    <RadioGroupItem value="cupon" />
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </RadioGroup>

            {/*
             * Panel del método activo: los datos bancarios para copiar y el
             * ticket a subir con transferencia; el cupón asignado con cupón.
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
              </div>
            ) : null}

            {payMethod === "cupon" ? (
              <Field>
                <FieldLabel>Cupón asignado</FieldLabel>
                <div className="flex items-center gap-2 pt-1">
                  <Badge variant="secondary" radius="full" className="gap-1.5">
                    <TicketPercentIcon className="size-3" />
                    <span className="font-mono tabular-nums">
                      {PAQUETE_COUPON_CODE}
                    </span>
                  </Badge>
                  <p className="text-muted-foreground text-xs">
                    Válido para cualquiera de los paquetes; el sistema lo
                    asigna por ti.
                  </p>
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
                  submittingCoupon || couponPolling || priceMxn === null
                }
              >
                {submittingCoupon || couponPolling ? (
                  <>
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    Aplicando…
                  </>
                ) : (
                  `Aplicar cupón ${PAQUETE_COUPON_CODE}`
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
                <Button variant="outline" size="lg" disabled={busy}>
                  Cancelar
                </Button>
              }
            />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
