import type { PaymentOrder } from "@/server/orden-pago/repository"

/*
 * Tipo compartido del listado de órdenes de pago para la UI
 * (/modulos/orden-de-pago) y su serializador: fechas ISO y solo campos que
 * viajan al cliente. Puro (sin server-only): lo importan la vista cliente,
 * la página RSC y las server actions.
 */

export interface PaymentOrderListItem {
  id: string
  code: string
  creatorUsername: string | null
  amountMxn: number
  note: string | null
  status: PaymentOrder["status"]
  bank: PaymentOrder["bank"]
  payerPhone: string | null
  ticketFileId: string | null
  scanStatus: string | null
  scanResult: Record<string, unknown> | null
  resolvedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

/** Límites del monto de una orden (espejo del CHECK de la tabla). */
export const PAYMENT_ORDER_MIN_MXN = 1
export const PAYMENT_ORDER_MAX_MXN = 50_000

/** Formato de dinero compartido por las vistas de órdenes de pago. */
export function paymentOrderMoney(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

/** Serializa la fila del repo para el cliente. */
export function toPaymentOrderListItem(order: PaymentOrder): PaymentOrderListItem {
  return {
    id: order.id,
    code: order.code,
    creatorUsername: order.creatorUsername,
    amountMxn: order.amountMxn,
    note: order.note,
    status: order.status,
    bank: order.bank,
    payerPhone: order.payerPhone,
    ticketFileId: order.ticketFileId,
    scanStatus: order.scanStatus,
    scanResult: order.scanResult,
    resolvedAt: order.resolvedAt,
    rejectionReason: order.rejectionReason,
    createdAt: order.createdAt,
  }
}

/** Etiqueta legible del estado para badges y filtros de la vista. */
export function paymentOrderStatusLabel(status: PaymentOrder["status"]): string {
  switch (status) {
    case "pending":
      return "Pendiente"
    case "paid":
      return "Pagada"
    case "rejected":
      return "Rechazada"
    case "cancelled":
      return "Cancelada"
  }
}
