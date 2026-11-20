import type { PaymentOrder } from "@/server/links-pago/repository"

/*
 * Tipo compartido del listado de órdenes de pago para la UI
 * (/modulos/links-de-pago) y su serializador: fechas ISO y solo campos que
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
  /** Primera apertura del link corto (spei.link → wa.me). */
  linkOpenedAt: string | null
  /** Primer contacto del pagador (teléfono ligado por entrega del código). */
  payerBoundAt: string | null
  ticketFileId: string | null
  scanStatus: string | null
  scanResult: Record<string, unknown> | null
  resolvedAt: string | null
  rejectionReason: string | null
  createdAt: string
  /** ID del pago de MP que confirmó el depósito (exclusivo por orden). */
  mpPaymentId: string | null
  /** Fecha de acreditación del depósito según MP. */
  mpDepositAt: string | null
  /** Cuándo entró en verificación de depósito. */
  verifyingSince: string | null
  /** Sondeos del verificador sin hallazgo. */
  depositChecks: number
  /** Escalamiento a resolución manual ya avisado. */
  depositEscalatedAt: string | null
}

/** Límites del monto de una orden (espejo del CHECK de la tabla). */
export const PAYMENT_ORDER_MIN_MXN = 1
export const PAYMENT_ORDER_MAX_MXN = 50_000

/** Límites del concepto de pago: UNA palabra alfanumérica (sin espacios). */
export const PAYMENT_ORDER_CONCEPTO_MIN = 3
export const PAYMENT_ORDER_CONCEPTO_MAX = 20

/**
 * Normaliza el concepto de pago de una orden: UNA palabra alfanumérica,
 * sin espacios ni caracteres especiales. Mayúsculas y sin acentos (las
 * quitan también los bancos al imprimir el comprobante; el mismo criterio
 * de `normalizarTexto` del matcheo). Null = inválido (vacío, con espacios,
 * con caracteres especiales o fuera de 3–20 caracteres).
 */
export function normalizePaymentOrderConcepto(raw: string): string | null {
  const upper = raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (!/^[A-Z0-9]+$/.test(upper)) return null
  if (
    upper.length < PAYMENT_ORDER_CONCEPTO_MIN ||
    upper.length > PAYMENT_ORDER_CONCEPTO_MAX
  ) {
    return null
  }
  return upper
}

/** Mensaje de error compartido del concepto de pago inválido. */
export const PAYMENT_ORDER_CONCEPTO_ERROR = `El concepto de pago es obligatorio: una sola palabra alfanumérica, sin espacios ni caracteres especiales, de ${PAYMENT_ORDER_CONCEPTO_MIN} a ${PAYMENT_ORDER_CONCEPTO_MAX} caracteres.`

/**
 * Ancla de CONCILIACIÓN de una orden: el concepto de pago que el pagador
 * escribe en su SPEI y que el escaneo valida en el comprobante. Las órdenes
 * nuevas lo traen en `note` (palabra obligatoria del creador); las de la era
 * previa (sin palabra válida) conservan el CÓDIGO del link como ancla — su
 * pagador ya lo recibió así. El código sigue existiendo siempre como
 * identificador del link corto (spei.link/CÓDIGO) y desambiguador.
 */
export function paymentOrderConceptAnchor(order: {
  note: string | null
  code: string
}): string {
  return normalizePaymentOrderConcepto(order.note ?? "") ?? order.code
}

/**
 * Slack de la ventana de casado orden ↔ depósito: [`created_at` − slack,
 * ahora]. Compartido por el verificador (carriles `verifying` y `pending`),
 * la guarda de unicidad en BD y el match deposit-side del webhook; el SQL
 * replica el mismo valor como `interval '2 minutes'`.
 */
export const PAYMENT_ORDER_DEPOSIT_SLACK_MS = 2 * 60_000

/** Rieles de DEPÓSITO de Mercado Pago que confirman una orden de pago. */
const DEPOSIT_OPERATION_TYPES = new Set(["account_fund", "money_transfer"])

/**
 * ¿El pago de MP es un DEPÓSITO acreditado elegible para casar una orden
 * (mismos criterios del reporte SPEI: SPEI a la CLABE o transferencia desde
 * el saldo de otra cuenta MP, aprobado y acreditado)? Es la puerta de la
 * rama de depósitos del webhook — un pago de checkout u otra operación
 * jamás reclama una orden por esta vía.
 */
export function isDepositLikePayment(input: {
  operationType?: unknown
  status?: unknown
  statusDetail?: unknown
}): boolean {
  return (
    typeof input.operationType === "string" &&
    DEPOSIT_OPERATION_TYPES.has(input.operationType) &&
    input.status === "approved" &&
    input.statusDetail === "accredited"
  )
}

/**
 * ¿La fecha del depósito cae dentro de la ventana de la orden
 * ([`created_at` − slack, ahora] — el límite superior lo acota la consulta
 * en vivo)? Es el predicado del match deposit-side del webhook; la guarda
 * autoritativa corre igual en SQL DENTRO del candado del claim.
 */
export function depositWithinOrderWindow(input: {
  orderCreatedAtMs: number
  depositAtMs: number | null
}): boolean {
  if (!Number.isFinite(input.orderCreatedAtMs)) return false
  if (input.depositAtMs === null || !Number.isFinite(input.depositAtMs)) {
    return false
  }
  return (
    input.depositAtMs >=
    input.orderCreatedAtMs - PAYMENT_ORDER_DEPOSIT_SLACK_MS
  )
}

/** Igualdad de importes a centavos (el criterio de casado del depósito). */
export function amountsEqualCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

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
    linkOpenedAt: order.linkOpenedAt,
    payerBoundAt: order.payerBoundAt,
    ticketFileId: order.ticketFileId,
    scanStatus: order.scanStatus,
    scanResult: order.scanResult,
    resolvedAt: order.resolvedAt,
    rejectionReason: order.rejectionReason,
    createdAt: order.createdAt,
    mpPaymentId: order.mpPaymentId,
    mpDepositAt: order.mpDepositAt,
    verifyingSince: order.verifyingSince,
    depositChecks: order.depositChecks,
    depositEscalatedAt: order.depositEscalatedAt,
  }
}

/** Etiqueta legible del estado para badges y filtros de la vista. */
export function paymentOrderStatusLabel(status: PaymentOrder["status"]): string {
  switch (status) {
    case "pending":
      return "Pendiente"
    case "verifying":
      return "Verificando depósito"
    case "paid":
      return "Pagada"
    case "rejected":
      return "Rechazada"
    case "cancelled":
      return "Cancelada"
  }
}
