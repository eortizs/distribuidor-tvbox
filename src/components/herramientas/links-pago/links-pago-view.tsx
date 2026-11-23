"use client"

import {useMemo, useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  BadgeCheckIcon,
  ChevronDownIcon,
  QrCodeIcon,
  XIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  paymentOrderConceptAnchor,
  paymentOrderMoney,
  paymentOrderStatusLabel,
  PAYMENT_ORDER_CONCEPTO_ERROR,
  normalizePaymentOrderConcepto,
  type PaymentOrderListItem,
} from "@/lib/links-pago"
import {
  cancelPaymentOrderAction,
  createPaymentOrderAction,
  getPaymentOrderLinkAction,
  resolvePaymentOrderAction,
  type CreatedPaymentOrder,
} from "@/app/actions/links-pago"
import { LinkCreadoDialog } from "@/components/herramientas/links-pago/link-creado-dialog"

/*
 * Vista del módulo SPEILink (/modulos/links-de-pago): formulario de
 * alta (importe + CONCEPTO DE PAGO obligatorio, una palabra alfanumérica)
 * que devuelve el link corto spei.link/<código> + QR; el concepto queda
 * OCULTO hasta que el pagador solicita el pago por WhatsApp y es el ancla
 * de conciliación del comprobante; listado de órdenes con el resultado del
 * escaneo y las acciones de revisión del creador.
 */

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
})

const STATUS_BADGE: Record<
  PaymentOrderListItem["status"],
  { variant: "warning-light" | "success-light" | "destructive-light" | "secondary" }
> = {
  pending: { variant: "warning-light" },
  verifying: { variant: "warning-light" },
  paid: { variant: "success-light" },
  rejected: { variant: "destructive-light" },
  cancelled: { variant: "secondary" },
}

interface ScanCheck {
  key: string
  label: string
  passed: boolean
  detail: string
}

/** Checks del escaneo guardado (misma forma que el flujo de transferencias). */
function scanChecksOf(order: PaymentOrderListItem): ScanCheck[] {
  const raw = order.scanResult?.checks
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is ScanCheck =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as ScanCheck).label === "string" &&
      typeof (item as ScanCheck).passed === "boolean"
  )
}

function scanReasonsOf(order: PaymentOrderListItem): string[] {
  const raw = order.scanResult?.reasons
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string")
}

interface LinksPagoViewProps {
  initialOrders: PaymentOrderListItem[]
  isAdmin: boolean
  whatsappConfigured: boolean
  scanConfigured: boolean
}

export function LinksPagoView({
  initialOrders,
  isAdmin,
  whatsappConfigured,
  scanConfigured,
}: LinksPagoViewProps) {
  const router = useRouter()
  const [orders, setOrders] = useState(initialOrders)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState<string>("")
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPaymentOrder | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PaymentOrderListItem | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [cancelTarget, setCancelTarget] = useState<PaymentOrderListItem | null>(null)
  const [approveTarget, setApproveTarget] = useState<PaymentOrderListItem | null>(null)
  const [creating, startCreating] = useTransition()
  const [linkOrderId, setLinkOrderId] = useState<string | null>(null)
  /** Último snapshot del servidor adoptado por el listado (identidad). */
  const [serverOrders, setServerOrders] = useState(initialOrders)

  // El RSC re-renderiza la página en cualquier momento (el bus de tiempo
  // real refresca la ruta en cada evento y las acciones revalidan): al
  // llegar un snapshot nuevo del servidor, adoptarlo — `useState` solo fija
  // el primer render y dejaría la lista congelada hasta un refresh manual.
  // Ajuste DURANTE el render (patrón React "adjust state when a prop
  // changes"), sin efectos.
  if (serverOrders !== initialOrders) {
    setServerOrders(initialOrders)
    setOrders(initialOrders)
  }

  const activeCount = useMemo(
    () =>
      orders.filter(
        (order) => order.status === "pending" || order.status === "verifying"
      ).length,
    [orders]
  )

  // Selector de cliente (Fase 3): el registro local es CORE; si el tenant
  // aún no tiene clientes, el select no se muestra (asociación opcional).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch("/api/clientes-registry")
        const payload = (await response.json()) as { ok: boolean; data?: { id: string; name: string }[] }
        if (!cancelled && payload.ok && (payload.data?.length ?? 0) > 0) {
          setClients(payload.data ?? [])
        }
      } catch {
        // Sin clientes o fallo de red: la asociación es opcional.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const parsed = Number(amount.replace(/[$,\s]/g, ""))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("Escribe el importe en pesos (ej. 350.00).")
      return
    }
    // El concepto de pago es obligatorio y viaja normalizado (mayúsculas,
    // sin acentos): es la palabra que el pagador escribe en su SPEI.
    if (!normalizePaymentOrderConcepto(note)) {
      setFormError(PAYMENT_ORDER_CONCEPTO_ERROR)
      return
    }
    startCreating(async () => {
      const result = await createPaymentOrderAction({
        amountMxn: parsed,
        note,
        clientId: clientId.length > 0 ? clientId : null,
      })
      if (result.error || !result.order) {
        setFormError(result.error ?? "No se pudo crear el link de pago.")
        return
      }
      const created = result.order
      setCreated(created)
      setAmount("")
      setNote("")
      setClientId("")
      // Alta optimista: la fila aparece al instante, sin esperar el refresco
      // del RSC (y sin importar si el usuario cierra el diálogo antes). El
      // snapshot del servidor la reemplaza con los mismos datos al llegar.
      setOrders((current) =>
        current.some((item) => item.id === created.orderId)
          ? current
          : [
              {
                id: created.orderId,
                code: created.code,
                creatorUsername: null,
                clientId: null,
                clientName: null,
                amountMxn: created.amountMxn,
                note: created.note,
                status: "pending",
                bank: created.bank,
                payerPhone: null,
                linkOpenedAt: null,
                payerBoundAt: null,
                ticketFileId: null,
                scanStatus: null,
                scanResult: null,
                resolvedAt: null,
                rejectionReason: null,
                createdAt: new Date().toISOString(),
                mpPaymentId: null,
                mpDepositAt: null,
                verifyingSince: null,
                depositChecks: 0,
                depositEscalatedAt: null,
              },
              ...current,
            ]
      )
      router.refresh()
    })
  }

  /**
   * Vuelve a mostrar el QR y el link de una orden ACTIVA: misma pieza del
   * diálogo de creación, armada de nuevo desde el snapshot guardado.
   */
  function showLink(order: PaymentOrderListItem) {
    setLinkOrderId(order.id)
    void getPaymentOrderLinkAction({ orderId: order.id })
      .then((result) => {
        if (result.error || !result.order) {
          toast.error(result.error ?? "No se pudo cargar el link de pago.")
          return
        }
        setCreated(result.order)
      })
      .finally(() => setLinkOrderId(null))
  }

  function resolveOrder(
    order: PaymentOrderListItem,
    decision: "approve" | "reject",
    reason?: string
  ) {
    setBusyOrderId(order.id)
    void resolvePaymentOrderAction({ orderId: order.id, decision, reason })
      .then((result) => {
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success(
          decision === "approve"
            ? `Link ${order.code} marcado como pagado`
            : `Link ${order.code} rechazado`
        )
        setOrders((current) =>
          current.map((item) =>
            item.id === order.id
              ? {
                  ...item,
                  status: decision === "approve" ? ("paid" as const) : ("rejected" as const),
                  resolvedAt: new Date().toISOString(),
                  rejectionReason: decision === "reject" ? (reason ?? null) : null,
                }
              : item
          )
        )
        router.refresh()
      })
      .finally(() => setBusyOrderId(null))
  }

  function cancelOrder(order: PaymentOrderListItem) {
    setBusyOrderId(order.id)
    void cancelPaymentOrderAction({ orderId: order.id })
      .then((result) => {
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success(`Link ${order.code} cancelado`)
        setOrders((current) =>
          current.map((item) =>
            item.id === order.id
              ? { ...item, status: "cancelled" as const, resolvedAt: new Date().toISOString() }
              : item
          )
        )
        router.refresh()
      })
      .finally(() => setBusyOrderId(null))
  }

  return (
    <>
      <Frame spacing="default" className="w-full">
        {/* Alta de la orden */}
        <FramePanel>
          <FrameHeader>
            <FrameTitle className="text-lg font-semibold">
              Nuevo link de pago
            </FrameTitle>
            <FrameDescription>
              Define el importe y el concepto de pago: el pagador abre el link,
              solicita el pago en el chat del agente y ahí recibe el concepto
              para pagar por SPEI; el comprobante se valida contra ese
              concepto.
            </FrameDescription>
          </FrameHeader>
          <div className="flex flex-col gap-3">
            {!whatsappConfigured ? (
              <Alert variant="destructive">
                <AlertTitle>Canal de WhatsApp no configurado</AlertTitle>
                <AlertDescription>
                  El servidor no tiene WHATSAPP_AGENT_NUMBER: no hay chat al
                  que apuntar el link de pago. Configúralo para usar el módulo.
                </AlertDescription>
              </Alert>
            ) : !scanConfigured ? (
              <Alert variant="warning">
                <AlertTitle>Validación automática no configurada</AlertTitle>
                <AlertDescription>
                  Sin RECEIPT_SCAN_MODEL los comprobantes quedan en revisión
                  manual: los apruebas tú desde este módulo.
                </AlertDescription>
              </Alert>
            ) : null}
            <form onSubmit={submitCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="orden-monto">Importe (MXN)</Label>
                  <Input
                    id="orden-monto"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Ej. 350.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={creating || !whatsappConfigured}
                  />
                </div>
                <div className="flex flex-[2] flex-col gap-1.5">
                  <Label htmlFor="orden-nota">Concepto de pago</Label>
                  <Input
                    id="orden-nota"
                    autoComplete="off"
                    maxLength={20}
                    placeholder="Ej. PAGOJUAN"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={creating || !whatsappConfigured}
                  />
                  <p className="text-muted-foreground text-xs">
                    Una sola palabra alfanumérica, sin espacios ni caracteres
                    especiales (3–20). El pagador la recibe por WhatsApp.
                  </p>
                </div>
              </div>
              {clients.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="orden-cliente">Cliente (opcional)</Label>
                  <select
                    id="orden-cliente"
                    className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    disabled={creating || !whatsappConfigured}
                  >
                    <option value="">Sin cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground text-xs">
                    Asocia este link a un cliente de tu registro
                    (Clientes → Nuevo cliente).
                  </p>
                </div>
              ) : null}
              {formError ? (
                <p className="text-destructive text-sm" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={creating || !whatsappConfigured}>
                  {creating ? "Creando…" : "Crear orden"}
                </Button>
              </div>
            </form>
          </div>
        </FramePanel>

        {/* Listado */}
        <FramePanel>
          <FrameHeader>
            <FrameTitle className="text-lg font-semibold">
              {isAdmin ? "Links" : "Mis links"}
              {orders.length > 0 ? (
                <span className="ml-2 font-normal text-muted-foreground text-sm">
                  {orders.length} · {activeCount} activa
                  {activeCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </FrameTitle>
            <FrameDescription>
              {isAdmin
                ? "Todos los links del panel; puedes intervenir en cualquiera."
                : "Tus links de pago y el resultado de cada comprobante."}
            </FrameDescription>
          </FrameHeader>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-muted-foreground text-sm">
                Sin links todavía. Crea la primera con el importe y el concepto de pago a cobrar.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {orders.map((order, index) => {
                const expanded = expandedId === order.id
                const checks = scanChecksOf(order)
                const reasons = scanReasonsOf(order)
                const busy = busyOrderId === order.id
                return (
                  <li
                    key={order.id}
                    className={index > 0 ? "border-t" : undefined}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : order.id)}
                    >
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                      />
                      <span className="font-mono font-semibold tracking-tight">
                        {order.code}
                      </span>
                      {order.note ? (
                        <span className="hidden truncate text-muted-foreground text-sm sm:inline">
                          {order.note}
                        </span>
                      ) : null}
                      {order.clientName ? (
                        <Badge variant="secondary" size="sm" className="hidden md:inline-flex">
                          {order.clientName}
                        </Badge>
                      ) : null}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {isAdmin && order.creatorUsername ? (
                          <span className="hidden text-muted-foreground text-xs md:inline">
                            {order.creatorUsername}
                          </span>
                        ) : null}
                        <span className="font-medium tabular-nums">
                          {paymentOrderMoney(order.amountMxn)}
                        </span>
                        <Badge
                          variant={STATUS_BADGE[order.status].variant}
                          size="default"
                        >
                          {paymentOrderStatusLabel(order.status)}
                        </Badge>
                      </span>
                    </button>
                    {expanded ? (
                      <div className="flex flex-col gap-3 pb-4">
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-muted-foreground text-xs">Creada</dt>
                            <dd>{dateFormatter.format(new Date(order.createdAt))}</dd>
                          </div>
                          {order.resolvedAt ? (
                            <div className="flex flex-col gap-0.5">
                              <dt className="text-muted-foreground text-xs">Resuelta</dt>
                              <dd>
                                {dateFormatter.format(new Date(order.resolvedAt))}
                              </dd>
                            </div>
                          ) : null}
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-muted-foreground text-xs">Concepto de pago</dt>
                            <dd className="font-mono">
                              {paymentOrderConceptAnchor(order)}
                            </dd>
                            <dd className="text-muted-foreground text-xs">
                              El pagador lo recibe al solicitar el pago por WhatsApp.
                            </dd>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-muted-foreground text-xs">Cuenta de cobro</dt>
                            <dd>
                              {order.bank.bank} · {order.bank.account}
                            </dd>
                            <dd className="text-muted-foreground text-xs">
                              Titular: {order.bank.holder}
                            </dd>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-muted-foreground text-xs">WhatsApp del pagador</dt>
                            <dd>
                              {order.payerPhone
                                ? `+${order.payerPhone}`
                                : "Aún no contacta"}
                            </dd>
                            {order.payerBoundAt ? (
                              <dd className="text-muted-foreground text-xs">
                                Contactó el{" "}
                                {dateFormatter.format(new Date(order.payerBoundAt))}
                              </dd>
                            ) : order.linkOpenedAt ? (
                              <dd className="text-muted-foreground text-xs">
                                Abrió el link el{" "}
                                {dateFormatter.format(new Date(order.linkOpenedAt))}
                              </dd>
                            ) : null}
                          </div>
                          {order.status === "verifying" ? (
                            <div className="flex flex-col gap-0.5">
                              <dt className="text-muted-foreground text-xs">Verificación de depósito</dt>
                              <dd>
                                Desde{" "}
                                {order.verifyingSince
                                  ? dateFormatter.format(new Date(order.verifyingSince))
                                  : "—"}
                              </dd>
                              <dd className="text-muted-foreground text-xs">
                                {order.depositEscalatedAt
                                  ? "Sin depósito tras 24 h: resuelve manualmente."
                                  : `Esperando la acreditación del depósito en la cuenta (${order.depositChecks} ${
                                      order.depositChecks === 1 ? "sondeo" : "sondeos"
                                    }).`}
                              </dd>
                            </div>
                          ) : null}
                          {order.mpPaymentId ? (
                            <div className="flex flex-col gap-0.5">
                              <dt className="text-muted-foreground text-xs">Depósito (Mercado Pago)</dt>
                              <dd className="break-all font-mono text-xs">
                                {order.mpPaymentId}
                              </dd>
                              {order.mpDepositAt ? (
                                <dd className="text-muted-foreground text-xs">
                                  Acreditado {dateFormatter.format(new Date(order.mpDepositAt))}
                                </dd>
                              ) : null}
                            </div>
                          ) : null}
                        </dl>

                        {checks.length > 0 ? (
                          <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3">
                            <p className="font-medium text-sm">
                              Verificación del comprobante
                            </p>
                            <ul className="flex flex-col gap-1">
                              {checks.map((check) => (
                                <li
                                  key={check.key}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  {check.passed ? (
                                    <BadgeCheckIcon
                                      aria-hidden="true"
                                      className="mt-0.5 size-4 shrink-0 text-success"
                                    />
                                  ) : (
                                    <XIcon
                                      aria-hidden="true"
                                      className="mt-0.5 size-4 shrink-0 text-destructive"
                                    />
                                  )}
                                  <span>
                                    {check.label}
                                    <span className="block text-muted-foreground text-xs">
                                      {check.detail}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {reasons.length > 0 ? (
                              <ul className="flex flex-col gap-0.5">
                                {reasons.map((reason) => (
                                  <li
                                    key={reason}
                                    className="text-destructive text-xs"
                                  >
                                    {reason}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : order.scanStatus && order.ticketFileId ? (
                          <p className="text-muted-foreground text-xs">
                            Comprobante recibido sin verificación automática:
                            revísalo manualmente antes de marcar pagada.
                          </p>
                        ) : order.status === "pending" ? (
                          <p className="text-muted-foreground text-xs">
                            Sin comprobante recibido todavía.
                          </p>
                        ) : null}

                        {order.status === "pending" || order.status === "verifying" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="lg"
                              disabled={busy}
                              onClick={() => setApproveTarget(order)}
                            >
                              Marcar pagada
                            </Button>
                            <Button
                              size="lg"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => {
                                setRejectTarget(order)
                                setRejectReason("")
                              }}
                            >
                              Rechazar
                            </Button>
                            <Button
                              size="lg"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setCancelTarget(order)}
                            >
                              Cancelar link
                            </Button>
                            <Button
                              size="lg"
                              variant="outline"
                              disabled={busy || linkOrderId === order.id}
                              onClick={() => showLink(order)}
                            >
                              <QrCodeIcon data-icon="inline-start" />
                              {linkOrderId === order.id ? "Cargando…" : "Ver QR y link"}
                            </Button>
                          </div>
                        ) : order.rejectionReason ? (
                          <p className="text-muted-foreground text-xs">
                            Motivo del rechazo: {order.rejectionReason}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </FramePanel>
      </Frame>

      {/* Diálogo de link creado: QR + link (componente compartido) */}
      <LinkCreadoDialog order={created} onClose={() => setCreated(null)} />

      {/* Confirmación de aprobación */}
      <AlertDialog
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Marcar el link {approveTarget?.code} como pagado?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El pagador recibirá la confirmación por WhatsApp
              {approveTarget?.payerPhone
                ? ` (+${approveTarget.payerPhone})`
                : " (aún no conocemos su número)"}
              . Úsalo solo si verificaste el pago.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyOrderId === approveTarget?.id}
              onClick={() => {
                if (approveTarget) resolveOrder(approveTarget, "approve")
                setApproveTarget(null)
              }}
            >
              Marcar pagada
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rechazo con motivo */}
      <AlertDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Rechazar el link {rejectTarget?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El pagador recibirá el aviso por WhatsApp con el motivo. El link
              queda en el historial y el código se libera.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="orden-rechazo">Motivo (opcional)</Label>
            <Input
              id="orden-rechazo"
              maxLength={300}
              placeholder="Ej. El importe no coincide"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyOrderId === rejectTarget?.id}
              onClick={() => {
                if (rejectTarget)
                  resolveOrder(rejectTarget, "reject", rejectReason.trim())
                setRejectTarget(null)
              }}
            >
              Rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelación de orden pendiente */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Cancelar el link {cancelTarget?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El código deja de ser válido: si el pagador intenta pagar, el
              agente le responderá que el link fue cancelado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyOrderId === cancelTarget?.id}
              onClick={() => {
                if (cancelTarget) cancelOrder(cancelTarget)
                setCancelTarget(null)
              }}
            >
              Cancelar link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
