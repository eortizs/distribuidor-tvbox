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
  /** Cliente del registro local asociado (Fase 3); null = sin cliente. */
  clientId: string | null
  clientName: string | null
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
 * Forma NORMALIZADA del concepto de pago (mayúsculas y sin acentos): la que
 * usa el MATCH del escaneo y el ancla de conciliación — el mismo criterio de
 * `normalizarTexto`, que ignora mayúsculas/minúsculas y acentos por ambos
 * lados. La palabra guardada y entregada al pagador conserva las
 * mayúsculas/minúsculas del creador (ver `conceptoPagoDeOrden` y
 * `paymentOrderConceptoVisible`). Null = inválido (vacío, con espacios, con
 * caracteres especiales o fuera de 3–20 caracteres).
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
 * Valida el concepto de pago CONSERVANDO las mayúsculas/minúsculas tal como
 * lo escribe el creador: UNA palabra alfanumérica de 3–20, sin espacios ni
 * caracteres especiales. Solo quita los acentos (los bancos también los
 * quitan al imprimir el comprobante; el match los ignora igual por ambos
 * lados). Es la palabra que se GUARDA en `note` y la que el pagador recibe
 * por WhatsApp — el escaneo matchea contra la forma normalizada, así que el
 * caseo exacto nunca rompe la conciliación. Null = inválido.
 */
export function conceptoPagoDeOrden(raw: string): string | null {
  const texto = raw
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (!/^[A-Za-z0-9]+$/.test(texto)) return null
  if (
    texto.length < PAYMENT_ORDER_CONCEPTO_MIN ||
    texto.length > PAYMENT_ORDER_CONCEPTO_MAX
  ) {
    return null
  }
  return texto
}

/**
 * Ancla de CONCILIACIÓN de una orden: el concepto de pago (forma NORMALIZADA,
 * mayúsculas y sin acentos) que el pagador escribe en su SPEI y que el
 * escaneo valida en el comprobante — el match ignora caseo y acentos por
 * ambos lados, así que la forma guardada nunca importa aquí. Las órdenes
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
 * El concepto de pago VISIBLE de una orden: la palabra tal como la escribió
 * el creador (mayúsculas/minúsculas respetadas — es lo que se le entrega al
 * pagador por WhatsApp y lo que ve el creador en el módulo), o el CÓDIGO del
 * link en las órdenes de la era previa (nota libre no válida). Para el MATCH
 * del escaneo usar `paymentOrderConceptAnchor`, nunca esta forma.
 */
export function paymentOrderConceptoVisible(order: {
  note: string | null
  code: string
}): string {
  const note = order.note?.trim() ?? ""
  return conceptoPagoDeOrden(note) ? note : order.code
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
    clientId: order.clientId,
    clientName: order.clientName,
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

/* -------------------------------------------------------------------------- */
/*    Canal del pagador: solicitud del link y atribución del comprobante      */
/* -------------------------------------------------------------------------- */

/**
 * Códigos de link: 4 caracteres del alfabeto sin ambigüedad (32 símbolos, sin
 * 0/O/1/I — el mismo de `transfer_concepts`). Fuente única de la FORMA: la
 * usan el proxy y el shortener para validar el segmento de
 * `spei.link/<CÓDIGO>` y el canal de WhatsApp para hallar el código dentro de
 * un mensaje.
 */
export function isPaymentLinkCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{4}$/.test(code)
}

/**
 * Tope de tokens con forma de código que se buscan por mensaje: un mensaje
 * enorme no debe poder sondear el espacio de códigos (los tokens reales de un
 * link o caption van en las primeras palabras).
 */
export const MAX_PAYMENT_ORDER_CODE_TOKENS = 5

const PAYMENT_ORDER_REQUEST_RE =
  /solicito\s+(?:un[ao]?\s+)?(?:orden|liga|link)\s+de\s+pago\s+por\s+\$?\s*(\d[\d.,]*)/i

/**
 * Primeros tokens del mensaje con FORMA de código de link, sin duplicados.
 * El código llega en la solicitud prellenada, pegado o reenviado a mano, y
 * viaja como una palabra más: aquí se aísla. Un token solo cuenta si además
 * matchea una orden real (chequeo en BD), así que un «chat» o «test» suelto
 * nunca secuestra el turno.
 */
export function findPaymentOrderCodeTokens(text: string): string[] {
  // El importe de una solicitud nunca es un código: un monto con forma de
  // código («$2345.00») no debe poder señalar otra orden.
  const sinImporte = text.replace(
    PAYMENT_ORDER_REQUEST_RE,
    (whole, amount) => whole.replace(amount, " ")
  )
  const tokens = sinImporte
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0 && isPaymentLinkCode(token))
  return [...new Set(tokens)].slice(0, MAX_PAYMENT_ORDER_CODE_TOKENS)
}

/**
 * Texto prellenado EXACTO: el pagador solicita el link por su monto y su
 * CÓDIGO. El código viaja en el mensaje para que cada link se solicite y se
 * pague por separado: la orden se identifica por su código y no por el
 * importe, así que otros links pendientes del mismo monto no estorban. El
 * CONCEPTO DE PAGO sigue oculto hasta esta solicitud (no va en el texto).
 */
export function paymentOrderRequestText(
  amountMxn: number,
  code: string
): string {
  return `Solicito un link de pago por ${paymentOrderMoney(
    amountMxn
  )} (código ${code})`
}

/**
 * Monto de una SOLICITUD de link de pago («Solicito un link de pago por
 * $500» — el texto prellenado del link corto, a veces editado a mano).
 * Acepta también las formas antiguas «liga de pago» y «orden de pago» (links
 * wa.me previos al dominio corto siguen circulando). Acepta $500 / 500 /
 * 1,500.50 / 500,50 y «MXN» pegado al final. Null = el texto no tiene forma de
 * solicitud o el monto no se entiende.
 */
export function parsePaymentOrderRequestAmount(text: string): number | null {
  const match = text.trim().match(PAYMENT_ORDER_REQUEST_RE)
  if (!match) return null
  const raw = match[1]
  // «1,500.50» (miles con coma, decimal con punto) vs «500,50» (coma decimal).
  const normalizado = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)
    ? raw.replace(/,/g, "")
    : raw.replace(/,/g, ".")
  const amount = Number.parseFloat(normalizado)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100) / 100
}

/** Importe legible de un texto del comprobante (misma lectura del escaneo). */
function importeLeido(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/[,\s$]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export interface DesambiguacionComprobante {
  order: PaymentOrder | null
  /** Ninguna señal dejó clara la orden: el llamador responde la guía del código. */
  ambiguo: boolean
  /** Señal que eligió la orden; null si no hubo elección. */
  via: "unica" | "codigo" | "importe" | "telefono" | null
}

/**
 * Elige la orden entre varias activas cuyo CONCEPTO DE PAGO coincide con el
 * impreso (la palabra no es única entre órdenes, a diferencia del código):
 * el código del caption, el importe leído del comprobante y el teléfono del
 * pagador ya ligado a UNA de ellas desambiguan — en ese orden, sin pedirle
 * nada al pagador. Orden null sin ambigüedad = sin coincidencias; con
 * ambigüedad el llamador pide el código (jamás se arriesga la orden
 * equivocada).
 */
export function desambiguarComprobantePorConcepto(input: {
  /** Órdenes activas cuyo ancla coincide con el concepto impreso. */
  coincidentes: PaymentOrder[]
  importeTexto: string | null
  /** Códigos con forma de código escritos por el pagador (caption). */
  tokens: string[]
  /** Teléfono que envía el comprobante. */
  phone: string
}): DesambiguacionComprobante {
  const coincidentes = input.coincidentes
  if (coincidentes.length === 0) return { order: null, ambiguo: false, via: null }
  if (coincidentes.length === 1) {
    return { order: coincidentes[0], ambiguo: false, via: "unica" }
  }

  const importe = importeLeido(input.importeTexto)
  const porImporte =
    importe === null
      ? coincidentes
      : coincidentes.filter((order) =>
          amountsEqualCents(order.amountMxn, importe)
        )

  // El código del caption es la palabra EXPLÍCITA del pagador: manda sobre
  // el importe (si luego no calza, la revisión lo rechaza con el motivo).
  const porCodigo = coincidentes.find((order) =>
    input.tokens.includes(order.code)
  )
  if (porCodigo) return { order: porCodigo, ambiguo: false, via: "codigo" }

  if (porImporte.length === 1) {
    return { order: porImporte[0], ambiguo: false, via: "importe" }
  }

  // Teléfono ligado: el sistema ya entregó el concepto de ESA orden a este
  // mismo chat (solicitud con el código de su link).
  const delTelefono = porImporte.filter(
    (order) => order.payerPhone === input.phone
  )
  if (delTelefono.length === 1) {
    return { order: delTelefono[0], ambiguo: false, via: "telefono" }
  }

  return { order: null, ambiguo: true, via: null }
}
