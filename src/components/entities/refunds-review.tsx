"use client"

/**
 * Reembolsos de Mercado Pago (solo admin, arriba del listado de `/clientes`,
 * junto a la revisión de transferencias): lista las órdenes cobradas cuya
 * renovación en FlujoTV falló (`renewal_failed`, reembolsables), las que
 * están en reembolso (`refunding`) y las cerradas (`refunded`, solo lectura
 * para trazabilidad). La acción «Reembolsar» devuelve el cobro TOTAL vía
 * `POST /api/reembolsos/orders/[id]/refund`: el servidor reclama la orden
 * atómicamente hacia `refunding` (bloquea reintentos de renovación), ejecuta
 * la devolución en la API de pagos de MP y cierra la orden como `refunded`.
 * Política: nunca se reembolsa una orden ya renovada. La sección se recarga
 * con los eventos en tiempo real de órdenes y desaparece sola cuando no hay
 * nada que mostrar.
 */

import { useCallback, useEffect, useState } from "react"
import {
  LoaderCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { formatMxn } from "@/lib/finanzas"
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
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  fetchRefundOrders,
  refundOrder,
  type RefundOrder,
} from "./pago-api"

const REFUND_WINDOW_DAYS = 180

/** Momento legible de la orden: «7 nov, 11:32». */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

/** Fuera de la ventana de reembolso de MP (180 días desde la aprobación). */
function isBeyondRefundWindow(order: RefundOrder): boolean {
  return (
    Date.now() - Date.parse(order.created_at) >
    REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
}

export function RefundsReview() {
  const [orders, setOrders] = useState<RefundOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<RefundOrder | null>(null)
  const [refundReason, setRefundReason] = useState("")

  const load = useCallback(() => {
    fetchRefundOrders()
      .then((data) => {
        setOrders(data)
        setError(null)
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudieron cargar los reembolsos."
        )
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Las órdenes cambian en otro dispositivo (u otra revisión): recargar. */
  useRealtimeEvent(["mp_order"], load)

  const confirmRefund = useCallback(async () => {
    const order = refundTarget
    if (!order) return
    setActingId(order.id)
    try {
      const result = await refundOrder(order.id, refundReason)
      if (result.status === "refunded") {
        toast.success("Reembolso aplicado", {
          description: `${order.user_name} · ${formatMxn(order.amount)} devuelto a Mercado Pago.`,
        })
      } else {
        toast.info(`Reembolso en estado «${result.status}»`)
      }
      setRefundTarget(null)
      setRefundReason("")
      load()
    } catch (cause: unknown) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "No se pudo reembolsar la orden."
      )
      load()
    } finally {
      setActingId(null)
    }
  }, [load, refundReason, refundTarget])

  // Mientras carga o sin nada que mostrar la sección no existe: cero ruido.
  if (orders === null && !error) return null

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>No se pudieron cargar los reembolsos</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
        </AlertDescription>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCwIcon aria-hidden="true" />
          Reintentar
        </Button>
      </Alert>
    )
  }

  const rows = orders ?? []
  if (rows.length === 0) return null

  const actionable = rows.filter((order) => order.status === "renewal_failed")

  return (
    <Card size="sm" className="gap-0 py-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Reembolsos</h2>
        <Badge
          variant={actionable.length > 0 ? "warning-light" : "secondary"}
          size="xs"
        >
          {rows.length}
        </Badge>
      </div>
      <Separator />
      <ul className="flex flex-col">
        {rows.map((order, index) => {
          const acting = actingId === order.id
          const refundable = order.status === "renewal_failed"
          return (
            <li key={order.id} className="flex flex-col">
              {index > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-2.5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {order.user_name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {order.months} {order.months === 1 ? "mes" : "meses"} ·{" "}
                      {formatMxn(order.amount)} ·{" "}
                      {order.buyer_username ?? "sin comprador"} ·{" "}
                      {formatWhen(order.created_at)}
                      {order.payment_id !== null
                        ? ` · pago ${order.payment_id}`
                        : ""}
                    </p>
                  </div>
                  {order.status === "refunded" ? (
                    <Badge variant="success-light" size="xs">
                      Reembolsada
                    </Badge>
                  ) : order.status === "refunding" ? (
                    <Badge variant="info-light" size="xs">
                      En curso
                    </Badge>
                  ) : isBeyondRefundWindow(order) ? (
                    <Badge
                      variant="warning-light"
                      size="xs"
                      title={`Mercado Pago rechaza reembolsos después de ${REFUND_WINDOW_DAYS} días desde la aprobación.`}
                    >
                      Fuera de ventana
                    </Badge>
                  ) : null}
                </div>
                {order.error ? (
                  <p
                    className="text-destructive line-clamp-2 text-xs"
                    title={order.error}
                  >
                    {order.error}
                  </p>
                ) : null}
                {refundable ? (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={actingId !== null}
                      onClick={() => {
                        setRefundReason("")
                        setRefundTarget(order)
                      }}
                    >
                      {acting ? (
                        <LoaderCircleIcon
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : null}
                      Reembolsar
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={refundTarget !== null}
        onOpenChange={(open) => {
          if (!open && actingId === null) setRefundTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Reembolsar {formatMxn(refundTarget?.amount ?? 0)} de{" "}
              {refundTarget?.user_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se devuelve el cobro completo a la cuenta de Mercado Pago del
              pagador (requiere saldo disponible; en tarjeta puede tardar días
              en reflejarse). La orden queda cerrada sin renovación y no se
              podrá reintentar. No se reembolsa la licencia si ya fue renovada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            aria-label="Nota del reembolso (opcional)"
            placeholder="Nota de auditoría (opcional): motivo, ticket, acuerdo con el cliente…"
            rows={3}
            maxLength={500}
            value={refundReason}
            onChange={(event) => setRefundReason(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actingId !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={actingId !== null}
              onClick={(event) => {
                event.preventDefault()
                void confirmRefund()
              }}
            >
              {actingId !== null ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              Reembolsar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
