"use client"

/**
 * Módulo «Abonar saldo» (`/modulos/abonar-saldo`): el mismo checkout de las
 * renovaciones (`/clientes`) con dos diferencias — el monto y el TIPO de
 * saldo los define el comprador. Dos categorías de saldo:
 *
 * - **Saldo en tokens**: para pagar el uso de herramientas que consumen
 *   APIs externas (fal.ai, OpenRouter, etc.).
 * - **Saldo en cupones**: para la compra de licencias de FlujoTV.
 *
 * Tres métodos idénticos para ambas categorías:
 *
 * - **Mercado Pago**: desglose del cargo (abono + costo por procesamiento +
 *   total engrosado con `mpTotalMxn`, para que el depósito neto acredite
 *   exactamente el monto definido) y redirección al `init_point`; el webhook
 *   acredita la billetera elegida y el retorno sondea
 *   `GET /api/mercadopago/orders/{id}` hasta ver la orden `applied`.
 * - **Transferencia**: flujo de dos pasos (concepto de pago + comprobante
 *   con escaneo automático); el crédito llega cuando el admin aprueba o el
 *   escaneo lo autoriza.
 * - **Cupón QA (0000)**: con `COUPON_QA_ENABLED`, el canje acredita al
 *   instante (respuesta sincrónica; idempotente por request_id).
 *
 * Los saldos (tokens y cupones) y los movimientos llegan del servidor; los
 * cambios en vivo (evento `mp_order` con estado `applied`) refrescan la
 * pantalla. La composición del sheet es la del sheet de compra de
 * `/clientes`: Drawer de Base UI con asa, selector de método en filas-tarjeta
 * sin selección por defecto y panel propio por método.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckIcon,
  CircleCheckIcon,
  CoinsIcon,
  CopyIcon,
  FileTextIcon,
  HashIcon,
  ImageIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  TicketPercentIcon,
  TriangleAlertIcon,
  TvIcon,
  UploadIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { REGEXP_ONLY_DIGITS } from "input-otp"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import type { RealtimeMessage } from "@/components/realtime/realtime-provider"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMxn } from "@/lib/finanzas"
import {
  parseAbonoAmount,
  parseSaldoTipo,
  saldoTipoLabel,
  SALDO_TIPOS,
  type AbonoAmountOk,
  type SaldoTipo,
} from "@/lib/saldo"
import { mpProcessingFeeMxn, mpTotalMxn } from "@/lib/mp-pricing"

import {
  createSaldoCouponOrder,
  createSaldoPaymentOrder,
  createSaldoTransferOrder,
  createTransferConcept,
  fetchPaymentOrder,
  retryOrderRenewal,
  PagoRequestError,
  type PaymentOrder,
  type TransferConcept,
} from "./saldo-api"

/** Métodos de pago del sheet de abono (los mismos de las renovaciones). */
type PayMethod = "mercadopago" | "transferencia" | "cupon"

/** Tamaño máximo del ticket de transferencia (igual que el servidor). */
const TICKET_MAX_BYTES = 10 * 1024 * 1024

/** Ruta del módulo: retorno del checkout y limpieza de la query. */
const MODULO_PATH = "/modulos/abonar-saldo"

/** Largo del código de cupón (0000). */
const COUPON_CODE_LENGTH = 4

/**
 * Ventana del sondeo de un canje de cupón desacoplado: ~2 min a razón de 2 s
 * por intento. La acreditación del abono es local, así que el caso normal
 * responde sincrónico; el sondeo cubre un proceso cortado a mitad.
 */
const COUPON_POLL_ATTEMPTS = 60
const COUPON_POLL_INTERVAL_MS = 2000

/** Montos rápidos para el campo: un toque llena el importe. */
const MONTOS_RAPIDOS = [100, 200, 500, 1000]

/**
 * Categorías de saldo del selector: metadatos de presentación. Los tokens
 * van primero (la novedad del módulo) y quedan preseleccionados; las
 * descripciones dejan inequívoco para qué sirve cada billetera.
 */
const SALDO_TIPO_META: Record<
  SaldoTipo,
  { label: string; description: string }
> = {
  tokens: {
    label: "Saldo en tokens",
    description: "Paga el uso de herramientas con APIs (fal.ai, OpenRouter, etc.).",
  },
  cupones: {
    label: "Saldo en cupones",
    description: "Compra y renueva licencias de FlujoTV.",
  },
}

/** Mes de vigencia legible: «noviembre de 2026». */
function formatCurrentMonth(): string {
  return new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
  }).format(new Date())
}

/** Momento legible del movimiento: «9 nov, 14:05». */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

export interface MovimientoView {
  id: string
  kind: string
  /** Billetera del movimiento: tokens o cupones. */
  tipo: SaldoTipo
  amount: number
  balance_after: number
  order_id: string | null
  note: string | null
  created_at: string
}

export interface TransferBankView {
  bank: string
  account: string
  holder: string
}

type PollStatus = "applied" | "renewal_failed" | "rejected" | "pending"

interface PollResult {
  status: PollStatus
  order: PaymentOrder | null
}

export function AbonarSaldoView({
  saldoCuponesInicial,
  saldoTokensInicial,
  movimientos,
  buyerUsername,
  couponEnabled,
  transferBank,
  returnOrder,
  returnState,
}: {
  /** Saldo en cupones actual de la cuenta (server-rendered). */
  saldoCuponesInicial: number
  /** Saldo en tokens actual de la cuenta (server-rendered). */
  saldoTokensInicial: number
  movimientos: MovimientoView[]
  /** Username del comprador: liga el concepto de pago de la transferencia. */
  buyerUsername: string
  couponEnabled: boolean
  transferBank: TransferBankView | null
  returnOrder: string | null
  returnState: string | null
}) {
  const router = useRouter()

  /**
   * Saldos mostrados: los del servidor más los créditos confirmados en vivo,
   * por billetera (`{ cupones, tokens }`).
   */
  const [saldos, setSaldos] = useState({
    cupones: saldoCuponesInicial,
    tokens: saldoTokensInicial,
  })
  /** Últimos saldos de servidor vistos: detecta props nuevas sin effects. */
  const [saldosServidor, setSaldosServidor] = useState({
    cupones: saldoCuponesInicial,
    tokens: saldoTokensInicial,
  })

  // Monto, tipo de saldo y sheet de pago.
  const [amountInput, setAmountInput] = useState("")
  const [saldoTipo, setSaldoTipo] = useState<SaldoTipo>("tokens")
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  // Mercado Pago.
  const [purchasing, setPurchasing] = useState(false)

  // Transferencia (dos pasos).
  const [transferStep, setTransferStep] = useState<"concepto" | "ticket">(
    "concepto"
  )
  const [transferConcept, setTransferConcept] = useState<TransferConcept | null>(
    null
  )
  const [loadingConcept, setLoadingConcept] = useState(false)
  const [conceptError, setConceptError] = useState<string | null>(null)
  const [conceptCopied, setConceptCopied] = useState(false)
  const [accountCopied, setAccountCopied] = useState(false)
  const [submittingTransfer, setSubmittingTransfer] = useState(false)
  const [transferRejected, setTransferRejected] = useState<{
    reasons: string[]
  } | null>(null)
  const conceptRequestedKey = useRef("")
  const [ticketFiles, ticketActions] = useFileUpload({
    accept: "image/*,application/pdf",
    multiple: false,
    maxSize: TICKET_MAX_BYTES,
  })

  // Cupón.
  const [couponCode, setCouponCode] = useState("")
  const [submittingCoupon, setSubmittingCoupon] = useState(false)
  /** Id de la intención de canje: se fija al abrir el checkout, no al render. */
  const couponRequestIdRef = useRef("")
  const [couponRetryOrderId, setCouponRetryOrderId] = useState<string | null>(
    null
  )
  const [couponPollOrderId, setCouponPollOrderId] = useState<string | null>(null)

  // Retorno del checkout de Mercado Pago.
  const [pollResult, setPollResult] = useState<PollResult | null>(null)

  const amount = useMemo(() => parseAbonoAmount(amountInput), [amountInput])
  const amountOk: AbonoAmountOk | null = amount.ok ? amount : null

  /**
   * Los saldos de servidor mandan: si las props trajeron valores nuevos
   * (refresh por realtime o retorno del checkout), se sincronizan durante
   * el render — patrón React «ajustar el estado cuando cambia una prop»,
   * sin pisar las actualizaciones optimistas mientras no haya datos nuevos.
   */
  if (
    saldosServidor.cupones !== saldoCuponesInicial ||
    saldosServidor.tokens !== saldoTokensInicial
  ) {
    setSaldosServidor({
      cupones: saldoCuponesInicial,
      tokens: saldoTokensInicial,
    })
    setSaldos({ cupones: saldoCuponesInicial, tokens: saldoTokensInicial })
  }

  /**
   * Desglose de Mercado Pago: la comisión del procesador va aparte para que
   * el abono real sea el monto definido (mismo engrose que las renovaciones).
   */
  const mpTotal =
    payMethod === "mercadopago" && amountOk
      ? mpTotalMxn(amountOk.amount)
      : null
  const mpFee =
    payMethod === "mercadopago" && amountOk
      ? mpProcessingFeeMxn(amountOk.amount)
      : null

  /** Ocupado del sheet: ningún cierre mientras una orden está en curso. */
  const busy =
    purchasing || submittingTransfer || submittingCoupon || couponPollOrderId !== null

  const closeCheckout = useCallback(() => {
    // Al cerrar se descarta la sesión: el método vuelve a null y el concepto
    // se descarta (pudo anularse o vencer; se re-consulta al volver).
    conceptRequestedKey.current = ""
    setTransferConcept(null)
    setConceptError(null)
    setConceptCopied(false)
    setTransferStep("concepto")
    setPayMethod(null)
    setPayError(null)
    setTransferRejected(null)
    setCouponRetryOrderId(null)
    ticketActions.clearFiles()
    setCheckoutOpen(false)
  }, [ticketActions])

  /* ---------------------------- Transferencia ---------------------------- */

  const loadTransferConcept = useCallback(async () => {
    const expectedKey = `${buyerUsername}:${new Date().getMonth()}`
    if (conceptRequestedKey.current === expectedKey) return
    conceptRequestedKey.current = expectedKey
    setLoadingConcept(true)
    setConceptError(null)
    try {
      const concept = await createTransferConcept({ userName: buyerUsername })
      setTransferConcept(concept)
    } catch (error) {
      setConceptError(
        error instanceof Error ? error.message : "No se pudo generar el concepto."
      )
      setTransferConcept(null)
    } finally {
      if (conceptRequestedKey.current === expectedKey) setLoadingConcept(false)
      conceptRequestedKey.current = ""
    }
  }, [buyerUsername])

  /** Al elegir transferencia se abre el paso 1 y se pide el concepto. */
  useEffect(() => {
    if (!checkoutOpen || payMethod !== "transferencia" || !transferBank) return
    if (transferConcept || loadingConcept) return
    void Promise.resolve().then(() => loadTransferConcept())
  }, [
    checkoutOpen,
    payMethod,
    transferBank,
    transferConcept,
    loadingConcept,
    loadTransferConcept,
  ])

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

  const submitTransfer = useCallback(async () => {
    if (!amountOk || !transferConcept) return
    const ticket = ticketFiles.files[0]?.file
    if (!(ticket instanceof File)) return
    setSubmittingTransfer(true)
    setPayError(null)
    setTransferRejected(null)
    try {
      const result = await createSaldoTransferOrder({
        amount: amountOk.amount,
        tipo: saldoTipo,
        concepto: transferConcept.code,
        file: ticket,
      })
      if (result.review === "auto_approved") {
        // Aprobado por el escaneo: el crédito aplica solo en el servidor
        // (local, segundos); el evento `mp_order` refresca el saldo.
        closeCheckout()
        toast.success("Abono autorizado", {
          description: `El comprobante pasó la verificación; ${formatMxn(result.amount)} se acreditarán en tu saldo en ${saldoTipoLabel(saldoTipo)} en unos segundos.`,
        })
        router.refresh()
      } else if (result.review === "auto_rejected") {
        // Se suelta el archivo rechazado: reenviar el mismo comprobante da
        // el mismo veredicto y cada envío crea otra orden pendiente.
        ticketActions.clearFiles()
        setTransferRejected({ reasons: result.reasons ?? [] })
        toast.error("Comprobante no autorizado", {
          description:
            "Contacta al administrador para una revisión manual de tu pago.",
        })
      } else {
        // Revisión manual (sin escaneo configurado, tope agotado o error):
        // el veredicto no llega solo, así que se libera con el aviso del
        // flujo de revisión del admin.
        closeCheckout()
        toast.success("Comprobante enviado", {
          description: `Tu abono de ${formatMxn(result.amount)} se acreditará en cuanto se confirme el pago.`,
        })
        router.refresh()
      }
    } catch (error) {
      // Concepto anulado en el servidor (transferencia aprobada/rechazada)
      // o vencido por cambio de mes: se descarta y el paso 1 re-consulta.
      if (
        error instanceof PagoRequestError &&
        error.code === "concepto_invalido"
      ) {
        conceptRequestedKey.current = ""
        setTransferConcept(null)
        setConceptError(null)
        setConceptCopied(false)
        setTransferStep("concepto")
        void loadTransferConcept()
      }
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el comprobante."
      )
    } finally {
      setSubmittingTransfer(false)
    }
  }, [amountOk, saldoTipo, transferConcept, ticketActions, ticketFiles.files, closeCheckout, loadTransferConcept, router])

  /* ---------------------------- Mercado Pago ----------------------------- */

  const submitPurchase = useCallback(async () => {
    if (!amountOk) return
    setPurchasing(true)
    setPayError(null)
    try {
      const order = await createSaldoPaymentOrder({
        amount: amountOk.amount,
        tipo: saldoTipo,
      })
      // Redirección completa al checkout de Mercado Pago (wallet_purchase):
      // el pago ocurre fuera del panel y el retorno lo maneja el aviso de
      // retorno; la acreditación la aplica el webhook del servidor.
      window.location.assign(order.initPoint)
    } catch (error) {
      setPayError(
        error instanceof Error ? error.message : "No se pudo iniciar el pago."
      )
      setPurchasing(false)
    }
  }, [amountOk, saldoTipo])

  /* -------------------------------- Cupón -------------------------------- */

  const submitCoupon = useCallback(async () => {
    if (!amountOk || couponCode.length !== COUPON_CODE_LENGTH) return
    const requestId = couponRequestIdRef.current
    if (requestId.length === 0) return
    setSubmittingCoupon(true)
    setPayError(null)
    try {
      const result = await createSaldoCouponOrder({
        amount: amountOk.amount,
        tipo: saldoTipo,
        code: couponCode,
        requestId,
      })
      if (result.status === "renewal_failed") {
        // El canje quedó registrado pero la acreditación no se confirmó: el
        // botón principal pasa a reintentar (misma orden, sin nuevo canje).
        setCouponRetryOrderId(result.orderId)
        setPayError(
          `El cupón se aceptó y quedó registrado (orden ${result.orderId.slice(0, 8)}…), pero el abono no se pudo acreditar.${result.error ? ` ${result.error}` : ""} Pulsa «Reintentar abono»: no se vuelve a canjear ni acredita doble.`
        )
      } else if (result.status === "applied") {
        closeCheckout()
        if (result.saldo !== null) {
          setSaldos((prev) => ({ ...prev, [saldoTipo]: result.saldo ?? prev[saldoTipo] }))
        }
        toast.success("Abono aplicado", {
          description: `${formatMxn(result.amount)} quedaron acreditados en tu saldo en ${saldoTipoLabel(saldoTipo)}.`,
        })
        router.refresh()
      } else {
        // Orden en proceso en el servidor: sondear hasta el resultado.
        setCouponPollOrderId(result.orderId)
      }
    } catch (error) {
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
  }, [amountOk, saldoTipo, couponCode, closeCheckout, router])

  /** Sondeo del canje en curso (orden `paid` con crédito desacoplado). */
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
        if (order.status === "applied") {
          const tipo = parseSaldoTipo(order.saldo_tipo) ?? saldoTipo
          setCouponPollOrderId(null)
          closeCheckout()
          setSaldos((prev) => ({ ...prev, [tipo]: prev[tipo] + order.amount }))
          toast.success("Abono aplicado", {
            description: `${formatMxn(order.amount)} quedaron acreditados en tu saldo en ${saldoTipoLabel(tipo)}.`,
          })
          router.refresh()
          return
        }
        if (order.status === "renewal_failed") {
          setCouponPollOrderId(null)
          setCouponRetryOrderId(order.id)
          setPayError(
            `El cupón se aceptó y quedó registrado (orden ${order.id.slice(0, 8)}…), pero el abono no se pudo acreditar.${order.error ? ` ${order.error}` : ""} Pulsa «Reintentar abono»: no se vuelve a canjear ni acredita doble.`
          )
          return
        }
      }

      if (attempts >= COUPON_POLL_ATTEMPTS) {
        setCouponPollOrderId(null)
        setPayError(
          "El cupón quedó registrado y el abono sigue aplicándose. Espera un momento y vuelve a pulsar «Aplicar cupón»: se consulta la misma orden sin canjear de nuevo."
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
  }, [couponPollOrderId, saldoTipo, closeCheckout, router])

  /** Reintento del crédito de un canje con acreditación fallida. */
  const retryCoupon = useCallback(async () => {
    if (!couponRetryOrderId) return
    setSubmittingCoupon(true)
    setPayError(null)
    try {
      const result = await retryOrderRenewal(couponRetryOrderId)
      if (result.status === "renewal_failed") {
        // Sin el error crudo del servidor (puede venir en inglés de la base
        // o de Mercado Pago): el motivo real vive en la orden para el admin.
        setPayError(
          `El abono volvió a fallar (orden ${couponRetryOrderId.slice(0, 8)}…). Quedó registrada para revisión; inténtalo de nuevo en unos minutos o contacta al administrador.`
        )
      } else if (result.status === "paid") {
        setPayError(
          "La acreditación sigue en curso con reintentos automáticos. La campana te avisará el resultado en unos minutos."
        )
      } else {
        closeCheckout()
        toast.success("Abono aplicado", {
          description: `Tu abono quedó acreditado en tu saldo en ${saldoTipoLabel(saldoTipo)}.`,
        })
        router.refresh()
      }
    } catch (error) {
      setPayError(
        error instanceof Error
          ? error.message
          : "No se pudo reintentar el abono."
      )
    } finally {
      setSubmittingCoupon(false)
    }
  }, [saldoTipo, couponRetryOrderId, closeCheckout, router])

  /* --------------------- Retorno del checkout de MP ---------------------- */

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
        if (order.status === "applied") {
          setPollResult({ status: "applied", order })
          toast.success("Abono aplicado", {
            description: "El pago quedó confirmado y acreditado en tu saldo.",
          })
          router.replace(MODULO_PATH)
          router.refresh()
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
  }, [returnOrder, returnState, router])

  /**
   * Estado de display del aviso de retorno: el resultado terminal del sondeo
   * manda y DEBE sobrevivir a la limpieza de la query (`router.replace`
   * borra `returnOrder` pero `pollResult` permanece), o el aviso de éxito se
   * desmontaría al instante.
   */
  const returnStatus: "working" | PollStatus | null =
    pollResult?.status ??
    (!returnOrder
      ? null
      : returnState === "rechazado"
        ? "rejected"
        : "working")

  /**
   * Tiempo real: el crédito de un abono (aprobación de transferencia o
   * webhook de Mercado Pago) refresca el saldo y el historial en vivo.
   */
  useRealtimeEvent(
    ["mp_order"],
    useCallback(
      (message: RealtimeMessage) => {
        if (message.kind === "mp_order" && message.status === "applied") {
          router.refresh()
        }
      },
      [router]
    )
  )

  return (
    <div className="flex flex-col gap-4">
      {/*
       * Aviso de retorno del checkout de Mercado Pago (back_urls). El estado
       * real vive en la orden y lo confirma el webhook; el sondeo refresca
       * el saldo al ver `applied` y limpia la query para no repetirlo.
       */}
      {returnStatus === "working" ? (
        <Alert variant="info">
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          <AlertTitle>Pago en verificación</AlertTitle>
          <AlertDescription>
            <p>
              Estamos confirmando el pago con Mercado Pago y acreditando tu
              abono; el saldo se actualizará en unos segundos. Puedes cerrar
              esta página sin riesgo: el cobro ya quedó registrado.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "applied" ? (
        <Alert variant="success">
          <CircleCheckIcon aria-hidden="true" />
          <AlertTitle>Abono aplicado</AlertTitle>
          <AlertDescription>
            <p>
              Tu abono quedó acreditado y el saldo ya lo muestra. Lo verás
              también en el historial de movimientos.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "renewal_failed" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>El pago llegó pero el abono no se acreditó</AlertTitle>
          <AlertDescription>
            <p>
              {pollResult?.order
                ? `Mercado Pago confirmó ${formatMxn(pollResult.order.amount)}, `
                : ""}
              pero el abono no se pudo acreditar en tu saldo. Avisa al
              administrador para que lo reintente
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
              ningún cargo ni abono. Puedes intentarlo de nuevo.
            </p>
          </AlertDescription>
        </Alert>
      ) : returnStatus === "pending" ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>El abono sigue en proceso</AlertTitle>
          <AlertDescription>
            <p>
              El pago quedó registrado; el abono se acreditará en cuanto
              Mercado Pago lo confirme. Recarga en un momento para ver el
              saldo actualizado.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
       * Saldos disponibles: las dos billeteras lado a lado, con su propósito
       * a la vista para que nunca haya duda de qué paga cada una. Los
       * números mandan (misma jerarquía); el historial vive abajo.
       */}
      <Card className="gap-3 p-5">
        <p className="text-muted-foreground text-xs font-medium">
          Saldo disponible
        </p>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <CoinsIcon aria-hidden="true" className="size-3.5" />
              Saldo en tokens
            </span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatMxn(saldos.tokens)}
            </span>
            <span className="text-muted-foreground text-xs">
              Para herramientas con APIs (fal.ai, OpenRouter…)
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <TvIcon aria-hidden="true" className="size-3.5" />
              Saldo en cupones
            </span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatMxn(saldos.cupones)}
            </span>
            <span className="text-muted-foreground text-xs">
              Para comprar y renovar licencias de FlujoTV
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Se acumulan en tu cuenta del panel; el abono entra cuando se
          confirma el pago.
        </p>
      </Card>

      {/*
       * Abono: primero el TIPO de saldo (tokens o cupones) y luego el
       * monto — la categoría decide a qué billetera entra el dinero. Un
       * solo botón primario; el checkout abre solo con monto válido.
       */}
      <Card className="gap-4 p-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Tipo de saldo</legend>
          <RadioGroup
            value={saldoTipo}
            onValueChange={(value) => setSaldoTipo(value as SaldoTipo)}
            aria-label="Tipo de saldo a abonar"
          >
            <FieldGroup className="gap-0 rounded-lg border">
              {SALDO_TIPOS.map((tipo, index) => {
                const meta = SALDO_TIPO_META[tipo]
                const Icon = tipo === "tokens" ? CoinsIcon : TvIcon
                return (
                  <Fragment key={tipo}>
                    {index > 0 ? <Separator /> : null}
                    <Field>
                      <FieldLabel
                        className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5"
                        onClick={() => setSaldoTipo(tipo)}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 opacity-60"
                          />
                          <FieldContent className="min-w-0">
                            <FieldTitle>{meta.label}</FieldTitle>
                            <FieldDescription className="text-xs">
                              {meta.description}
                            </FieldDescription>
                          </FieldContent>
                        </span>
                        <RadioGroupItem value={tipo} />
                      </FieldLabel>
                    </Field>
                  </Fragment>
                )
              })}
            </FieldGroup>
          </RadioGroup>
        </fieldset>
        <Field>
          <FieldLabel htmlFor="abono-monto">
            Monto a abonar en {saldoTipoLabel(saldoTipo)}
          </FieldLabel>
          <InputGroup className="h-12">
            <InputGroupAddon align="inline-start" className="pl-3.5">
              <span aria-hidden="true" className="text-muted-foreground text-sm">
                $
              </span>
            </InputGroupAddon>
            <InputGroupInput
              id="abono-monto"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              aria-label={`Monto a abonar en pesos mexicanos al saldo en ${saldoTipoLabel(saldoTipo)}`}
              className="h-full text-lg font-semibold tabular-nums"
            />
            {amountInput.length > 0 ? (
              <InputGroupAddon align="inline-end" className="mr-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 rounded-full"
                  onClick={() => setAmountInput("")}
                  aria-label="Limpiar el monto"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          {!amount.ok && amountInput.trim().length > 0 ? (
            <p className="text-destructive text-xs" role="alert">
              {amount.message}
            </p>
          ) : (
            <FieldDescription>
              El monto es libre: cualquier cantidad mayor a $0. Con Mercado
              Pago la comisión se cobra aparte y tu saldo recibe el monto
              completo.
            </FieldDescription>
          )}
        </Field>
        <div
          role="group"
          aria-label="Montos rápidos"
          className="flex flex-wrap items-center gap-2"
        >
          {MONTOS_RAPIDOS.map((monto) => (
            <Button
              key={monto}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full tabular-nums"
              onClick={() => setAmountInput(String(monto))}
            >
              {formatMxn(monto)}
            </Button>
          ))}
        </div>
        <Button
          size="lg"
          className="w-full"
          disabled={!amountOk}
          onClick={() => {
            setPayMethod(null)
            setPayError(null)
            setTransferRejected(null)
            setCouponRetryOrderId(null)
            couponRequestIdRef.current =
              typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`
            ticketActions.clearFiles()
            setCheckoutOpen(true)
          }}
        >
          {amountOk
            ? `Continuar con ${formatMxn(amountOk.amount)} en ${saldoTipoLabel(saldoTipo)}`
            : "Continuar al pago"}
        </Button>
      </Card>

      {/*
       * Historial: últimas entradas del libro mayor; el saldo después de
       * cada abono queda como evidencia del momento.
       */}
      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Movimientos</h2>
          <Badge variant="secondary" size="xs">
            {movimientos.length}
          </Badge>
        </div>
        {movimientos.length === 0 ? (
          <div className="px-4 pb-4">
            <p className="text-muted-foreground text-xs" role="status">
              Aún no tienes movimientos: tu primer abono aparecerá aquí en
              cuanto se confirme el pago.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {movimientos.map((mov, index) => (
              <li key={mov.id} className="flex flex-col">
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                      Abono de saldo en {saldoTipoLabel(mov.tipo)}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {formatWhen(mov.created_at)} · saldo en{" "}
                      {saldoTipoLabel(mov.tipo)}{" "}
                      {formatMxn(mov.balance_after)}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    +{formatMxn(mov.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
       * Sheet de pago (Drawer de Base UI): resumen compacto, selector de
       * método (radio en filas-tarjeta, sin selección por defecto; tocar
       * abre la pantalla del método) y panel del método activo. Mientras
       * procesa no se cierra ni con Escape ni con swipe.
       */}
      <Drawer
        open={checkoutOpen}
        onOpenChange={(open) => {
          if (!open && busy) return
          if (!open) closeCheckout()
          setCheckoutOpen(open)
        }}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Abonar saldo</DrawerTitle>
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
             * Resumen: solo lo relevante — a qué billetera entra el dinero
             * (tokens o cupones, tal cual se eligió) y cuánto se cobra. El
             * monto definido manda a la derecha en grande.
             */}
            {amountOk ? (
              <div className="flex items-end justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold tracking-tight">
                    Abono a tu saldo en {saldoTipoLabel(saldoTipo)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Entra a tu saldo en {saldoTipoLabel(saldoTipo)} al
                    confirmarse el pago
                  </span>
                </div>
                {mpTotal === null ? (
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMxn(amountOk.amount)}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/*
             * Mercado Pago: pantalla propia — la lista desaparece y solo
             * queda el desglose del cargo. El total es el monto engrosado
             * (`mpTotalMxn`): la comisión (3.49% + $4) y su IVA van aparte,
             * así que el depósito neto acredita exactamente el monto
             * definido y el webhook verifica la orden contra ese total.
             */}
            {payMethod === "mercadopago" && amountOk ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Abono a tu saldo en {saldoTipoLabel(saldoTipo)}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMxn(amountOk.amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Costo por procesamiento
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMxn(mpFee ?? 0)}
                    </span>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMxn(mpTotal ?? 0)}
                  </span>
                </div>
              </div>
            ) : payMethod === null ? (
              /*
               * Selector de método: filas-tarjeta con radio al final; sin
               * selección por defecto. Tocar una fila abre directamente la
               * pantalla de ese método. La transferencia solo se ofrece si
               * el servidor tiene los datos bancarios; el cupón solo con el
               * modo QA activado (`COUPON_QA_ENABLED=1`).
               */
              <RadioGroup
                value={payMethod ?? ""}
                onValueChange={(value) => {
                  setPayMethod(value as PayMethod)
                  setPayError(null)
                  setTransferRejected(null)
                  if (value === "transferencia") setTransferStep("concepto")
                }}
                aria-label="Método de pago"
              >
                <FieldGroup className="gap-0">
                  <Field>
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
                            En línea · abono automático al confirmarse
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
                                abono inmediato
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
             * Panel de la transferencia: flujo de DOS pasos. Paso 1: datos
             * bancarios y el concepto de pago (código de 4 caracteres) que
             * el comprador escribe en su transferencia. Paso 2: el ticket a
             * subir, validado por el servidor contra ese concepto.
             */}
            {transferBank && payMethod === "transferencia" && amountOk ? (
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Monto a transferir</span>
                      <span className="font-medium tabular-nums">
                        {formatMxn(amountOk.amount)}
                      </span>
                    </div>
                  </div>
                  <Separator />
                  {/*
                   * Concepto de pago (paso 1): código único del comprador +
                   * mes. El comprador lo escribe en su transferencia y el
                   * comprobante debe traerlo impreso para pasar la
                   * verificación automática.
                   */}
                  <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
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
                          onClick={() => void loadTransferConcept()}
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
                   * Veredicto del escaneo automático: el comprobante se
                   * guardó y quedó `pending`, pero no pasó alguna condición
                   * (mes, concepto, importe o beneficiario). El sheet
                   * permanece abierto para permitir subir otro comprobante.
                   */}
                  {transferRejected ? (
                    <Alert variant="warning">
                      <TriangleAlertIcon aria-hidden="true" />
                      <AlertTitle>Comprobante no autorizado</AlertTitle>
                      <AlertDescription>
                        <p>
                          Tu comprobante no pasó la verificación automática y
                          el abono no se aplicó. Contacta al administrador
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
             * activos al aplicar y acredita al instante.
             */}
            {payMethod === "cupon" && amountOk ? (
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
                  El cupón se valida en el servidor y el abono se acredita al
                  instante.
                </p>
              </div>
            ) : null}

            {/*
             * Volver a la lista de métodos desde la pantalla del método
             * activo (Mercado Pago o cupón). En la transferencia no existe:
             * al llegar ahí el comprador ya hizo la transferencia.
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
                onClick={() => void retryCoupon()}
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
                  "Reintentar abono"
                )}
              </Button>
            ) : payMethod === "cupon" ? (
              <Button
                size="lg"
                onClick={() => void submitCoupon()}
                disabled={
                  submittingCoupon ||
                  couponCode.length !== COUPON_CODE_LENGTH ||
                  !amountOk
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
                  onClick={() => setTransferStep("ticket")}
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
                    !amountOk
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
            ) : payMethod === "mercadopago" && amountOk ? (
              /* Pantalla de Mercado Pago: el primario abre el checkout. */
              <Button
                size="lg"
                onClick={() => void submitPurchase()}
                disabled={purchasing}
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
                  `Pagar ${formatMxn(mpTotal ?? 0)} con Mercado Pago`
                )}
              </Button>
            ) : null}
            {/* Lista sin selección: solo Cancelar; el primario aparece al
                entrar a la pantalla del método elegido. */}
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
