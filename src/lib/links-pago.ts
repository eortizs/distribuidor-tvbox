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
  /**
   * 'link' = importe y concepto definidos por el cobrador; 'qr' = pago libre
   * del QR fijo (importe leído del comprobante; `note`, si existe, es el
   * concepto libre que escribió el pagador, solo informativo); 'nota' = nota
   * digital (importe congelado de una comanda; `note` siempre null, el
   * concepto del comprobante es libre).
   */
  origin: PaymentOrderOrigin
  status: PaymentOrder["status"]
  bank: PaymentOrder["bank"]
  payerPhone: string | null
  payerName: string | null
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

export const PAYMENT_ORDER_PAYER_NAME_MAX = 80

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

export function normalizePaymentOrderPayerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(
      /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
  if (!name) return null
  return (
    Array.from(name)
      .slice(0, PAYMENT_ORDER_PAYER_NAME_MAX)
      .join("")
      .trim() || null
  )
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
 * Ancla de DESCUBRIMIENTO de una orden: el concepto de pago (forma
 * NORMALIZADA, mayúsculas y sin acentos) que el pagador SUGERIMOS escribir
 * en su SPEI — cuando el comprobante lo trae impreso, identifica la orden
 * entre las pendientes (el canal de WhatsApp lo usa para descubrir, jamás
 * para rechazar: el concepto es libre y la validación es solo por importe).
 * El match ignora caseo y acentos por ambos lados. Las órdenes nuevas lo
 * traen en `note` (palabra del creador); las de la era previa (sin palabra
 * válida) conservan el CÓDIGO del link como ancla. El código sigue
 * existiendo siempre como identificador del link corto (spei.link/CÓDIGO) y
 * desambiguador.
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
    origin: order.origin,
    status: order.status,
    bank: order.bank,
    payerPhone: order.payerPhone,
    payerName: order.payerName,
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
const NOTA_DIGITAL_REQUEST_RE =
  /solicito\s+pagar\s+mi\s+nota\s+digital\s+[A-HJ-NP-Z2-9]{4}\s+por\s+\$?\s*(\d[\d.,]*)/i

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
  const sinImporte = text
    .replace(PAYMENT_ORDER_REQUEST_RE, (whole, amount) =>
      whole.replace(amount, " ")
    )
    .replace(NOTA_DIGITAL_REQUEST_RE, (whole, amount) =>
      whole.replace(amount, " ")
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
 * Texto prellenado de una NOTA DIGITAL: el pagador solicita pagar su comanda
 * por su CÓDIGO (el folio de la nota). El código viaja en el mensaje para que
 * `findPendingPaymentOrderByAnyCode` ligue el teléfono a ESA orden — con
 * varias comandas del mismo importe no hay ambigüedad. El importe se muestra
 * como referencia, nunca como identidad.
 */
export function notaDigitalRequestText(
  code: string,
  amountMxn: number
): string {
  return `Solicito pagar mi nota digital ${code} por ${paymentOrderMoney(
    amountMxn
  )}`
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

/* -------------------------------------------------------------------------- */
/*      QR FIJO de cobro: pago libre — monto y concepto los pone el pagador    */
/* -------------------------------------------------------------------------- */

/**
 * Origen de una orden de pago:
 *  - 'link': importe y concepto definidos por el cobrador (el concepto es
 *    una SUGERENCIA: el pagador puede escribir otro y el cobro se valida
 *    igual);
 *  - 'qr': pago libre del QR FIJO (importe y concepto del pagador, leídos de
 *    su comprobante);
 *  - 'nota': nota digital (importe congelado de una comanda del catálogo;
 *    el concepto del comprobante es libre y `note` siempre es null).
 *
 * En TODOS los orígenes el concepto impreso del comprobante es libre: la
 * validación es SOLO por importe exacto y acreditación del depósito. La
 * palabra del creador queda como señal de DESCUBRIMIENTO del comprobante
 * (`paymentOrderConceptAnchor`), nunca como requisito.
 */
export type PaymentOrderOrigin = "link" | "qr" | "nota"

/**
 * ¿La orden SUGIERE un concepto de pago al pagador? Los links entregan la
 * palabra del creador por WhatsApp: escribirla ayuda a identificar el cobro
 * (descubrimiento del comprobante y columna «Concepto» del reporte
 * SPEILink), pero ya NO es obligatoria — la validación del comprobante es
 * SOLO por importe exacto + depósito acreditado. El QR fijo y la nota
 * digital son pago libre puro: sin concepto sugerido.
 */
export function sugiereConceptoDePago(order: {
  origin: PaymentOrderOrigin
}): boolean {
  return order.origin === "link"
}

/**
 * Código del QR FIJO de un cobrador: 6 caracteres del mismo alfabeto sin
 * ambigüedad de los links. Se eligen SEIS a propósito — un código de link
 * tiene 4 y `findPaymentOrderCodeTokens` solo extrae tokens de 4 — así el
 * código de cobrador nunca puede confundirse con el de una orden.
 */
export const COBRADOR_QR_CODE_LENGTH = 6

export function isCobradorQrCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code)
}

/** Segmento del dominio corto reservado al QR fijo: `spei.link/cobro/<CÓDIGO>`. */
export const COBRADOR_QR_PATH = "/cobro"

export function cobradorQrShortPath(code: string): string {
  return `${COBRADOR_QR_PATH}/${code}`
}

/**
 * Código del QR fijo dentro de una ruta del dominio corto
 * (`/cobro/<código>`, sin distinguir mayúsculas/minúsculas). Null = no es la
 * ruta del QR o el código no tiene la forma válida (el proxy responde 404).
 */
export function parseCobradorQrPath(pathname: string): string | null {
  const match = /^\/cobro\/([A-Za-z0-9]+)\/?$/i.exec(pathname)
  if (!match) return null
  const code = match[1].toUpperCase()
  return isCobradorQrCode(code) ? code : null
}

/**
 * ¿La ruta cae bajo el espacio del QR fijo (`/cobro` o `/cobro/…`)? El proxy
 * lo usa para responder 404 ahí mismo cuando `parseCobradorQrPath` no dio un
 * código válido: ese espacio jamás se interpreta como un link de pago.
 */
export function isCobradorQrPath(pathname: string): boolean {
  return /^\/cobro(?:\/|$)/i.test(pathname)
}

/**
 * Texto prellenado EXACTO del QR fijo: abre el chat del número del negocio
 * con la solicitud y el código del cobrador. El código viaja en el mensaje
 * porque un mismo número de WhatsApp atiende a TODOS los cobradores del
 * panel: sin él, el sistema no sabría de quién es el QR (ni a qué cuenta
 * va el dinero).
 */
export function cobradorQrRequestText(code: string): string {
  return `Solicito realizar un pago. (cobrador ${code})`
}

const COBRADOR_QR_REQUEST_RE = /\bsolicito\s+realizar\s+un\s+pago\b/i
const COBRADOR_QR_TOKEN_RE = /\bcobrador\s+([A-HJ-NP-Z2-9]{6})\b/i

/**
 * ¿El mensaje es la SOLICITUD del QR fijo? `{ code }` con el código de
 * cobrador (en mayúsculas) o `code: null` cuando la frase está pero el
 * código falta o no es válido. Null = el mensaje no es una solicitud de QR.
 */
export function parseCobradorQrRequest(
  text: string
): { code: string | null } | null {
  if (!COBRADOR_QR_REQUEST_RE.test(text)) return null
  const match = COBRADOR_QR_TOKEN_RE.exec(text)
  return { code: match ? match[1].toUpperCase() : null }
}

/** Órdenes de QR fijo activas (pendientes o verificando) por teléfono. */
export const QR_MAX_ACTIVE_PER_PAYER = 3

/**
 * Vigencia de una SOLICITUD del QR fijo —el escaneo que entrega la CLABE al
 * pagador—: durante estos días un comprobante enviado desde el MISMO número
 * de WhatsApp se atribuye al cobrador de ese QR. Pasado el plazo el pagador
 * reescanea y vuelve a enviar su comprobante.
 */
export const PAYMENT_QR_REQUEST_WINDOW_MS = 7 * 24 * 60 * 60_000

/**
 * Con solicitudes vigentes en VARIOS cobradores (un mismo teléfono escribió a
 * dos QR del panel) gana la más recientemente escaneada si es reciente: quien
 * vuelve a escanear el QR de la persona que le cobró y reenvía el comprobante
 * queda identificado sin que se le pida nada más.
 */
export const PAYMENT_QR_REQUEST_FRESH_MS = 30 * 60_000

/** Solicitud vigente de un pagador del QR fijo (fila de `payment_qr_requests`). */
export interface PaymentQrRequest {
  cobradorUserId: string
  /** Último escaneo: el pagador recibió ahí los datos de la cuenta. */
  lastRequestedAt: string
}

export type CobradorDelQr =
  | { kind: "cobrador"; cobradorUserId: string; lastRequestedAt: string }
  | { kind: "sin_solicitud" }
  | { kind: "ambiguo" }

/**
 * ¿A qué cobrador se atribuye un comprobante del QR fijo? El pagador se
 * identifica por su TELÉFONO de WhatsApp: sus solicitudes vigentes dicen a
 * quién le tocaba pagar. Una sola → ese. Varias → la del último escaneo si
 * es reciente y no hay empate; si no, se le pide reescanear (jamás se
 * arriesga la cuenta equivocada).
 */
export function cobradorDelQr(
  requests: PaymentQrRequest[],
  now: number = Date.now()
): CobradorDelQr {
  if (requests.length === 0) return { kind: "sin_solicitud" }
  if (requests.length === 1) {
    return {
      kind: "cobrador",
      cobradorUserId: requests[0].cobradorUserId,
      lastRequestedAt: requests[0].lastRequestedAt,
    }
  }
  const sorted = [...requests].sort(
    (first, second) =>
      Date.parse(second.lastRequestedAt) - Date.parse(first.lastRequestedAt)
  )
  const newest = sorted[0]
  const newestMs = Date.parse(newest.lastRequestedAt)
  const nextMs = sorted[1] ? Date.parse(sorted[1].lastRequestedAt) : Number.NEGATIVE_INFINITY
  if (newestMs >= now - PAYMENT_QR_REQUEST_FRESH_MS && newestMs > nextMs) {
    return {
      kind: "cobrador",
      cobradorUserId: newest.cobradorUserId,
      lastRequestedAt: newest.lastRequestedAt,
    }
  }
  return { kind: "ambiguo" }
}

/** Hora de México (CDMX): sin horario de verano desde 2022, fija en UTC−6. */
const CDMX_OFFSET_MS = 6 * 60 * 60_000

/**
 * Fecha y hora IMPRESAS en el comprobante (`YYYY-MM-DD` + `HH:mm` en 24 h,
 * hora de México) como instante; null si falta alguna o no tiene la forma.
 */
export function instanteDelComprobante(
  fecha: string | null,
  hora: string | null
): number | null {
  if (!fecha || !hora) return null
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  const h = /^(\d{2}):(\d{2})$/.exec(hora)
  if (!f || !h) return null
  const year = Number(f[1])
  const month = Number(f[2])
  const day = Number(f[3])
  const hour = Number(h[1])
  const minute = Number(h[2])
  if (hour > 23 || minute > 59) return null
  // Fecha de calendario real (Date.UTC «corrige» el 32 de diciembre).
  const dayStart = new Date(Date.UTC(year, month - 1, day))
  if (
    dayStart.getUTCFullYear() !== year ||
    dayStart.getUTCMonth() !== month - 1 ||
    dayStart.getUTCDate() !== day
  ) {
    return null
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute) + CDMX_OFFSET_MS
  return Number.isFinite(ms) ? ms : null
}

/**
 * Inicio de una orden nacida del QR FIJO (`created_at`): es también el
 * inicio de su ventana de depósito en Mercado Pago ([inicio − tolerancia,
 * ahora]), así que debe ser el momento en que el pagador PAGÓ, nunca antes de
 * haber recibido los datos de la cuenta. Regla: la hora impresa en el
 * comprobante cuando es legible y no anterior al último escaneo; si no, el
 * último escaneo. Nunca en el futuro. Así un comprobante VIEJO (de una
 * transferencia anterior al escaneo) no puede confirmar un cobro nuevo: su
 * depósito cae antes de la ventana.
 */
export function paymentQrOrderStart(input: {
  lastRequestedAt: string
  receiptFecha: string | null
  receiptHora: string | null
  now?: number
}): Date {
  const now = input.now ?? Date.now()
  const scannedMs = Date.parse(input.lastRequestedAt)
  const floor = Number.isFinite(scannedMs) ? scannedMs : now
  const printedMs = instanteDelComprobante(input.receiptFecha, input.receiptHora)
  const startMs =
    printedMs !== null && printedMs >= floor && printedMs <= now
      ? printedMs
      : floor
  return new Date(Math.min(startMs, now))
}

/** Tope del concepto libre guardado como referencia (nunca se valida). */
export const PAYMENT_ORDER_NOTE_MAX = 120

/**
 * Rótulo de la columna «Concepto» del reporte SPEILink cuando el depósito
 * confirmó un pago por QR fijo sin concepto escrito: identifica el origen en
 * vez de caer a la inferencia por ventana de las renovaciones.
 */
export const PAYMENT_QR_REPORT_LABEL = "QR fijo"

/** Rótulo del reporte SPEILink cuando el depósito confirmó una nota digital. */
export const NOTA_DIGITAL_REPORT_LABEL = "Nota"

/**
 * Concepto LIBRE impreso en el comprobante de un pago por QR fijo: se guarda
 * como referencia informativa para el cobrador y el reporte SPEILink. No se
 * exige ni se valida — el pagador escribe lo que quiera en su transferencia.
 */
export function conceptoLibreDeComprobante(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return null
  const cut = Array.from(clean).slice(0, PAYMENT_ORDER_NOTE_MAX).join("").trim()
  return cut || null
}

/**
 * Importe legible de un texto del comprobante, a centavos — u null si no se
 * entiende con certeza. Lo usan la desambiguación por importe y el pago
 * libre del QR fijo, donde el importe de la orden es el que declara el
 * comprobante: por eso NO adivina. Acepta lo que imprimen los bancos
 * («500.00», «$350», «1,500.50» con miles por coma); rechaza las formas
 * ambiguas («500,00» o «12.345», que podrían ser 500 o 50 000).
 */
export function leerImporteDeComprobante(value: string | null): number | null {
  if (!value) return null
  const cuerpo = value.replace(/[$\s]/g, "")
  const conMiles = /^\d{1,3}(,\d{3})+(?:\.\d{1,2})?$/.test(cuerpo)
  const plano = /^\d+(?:\.\d{1,2})?$/.test(cuerpo)
  if (!conMiles && !plano) return null
  const parsed = Number(conMiles ? cuerpo.replace(/,/g, "") : cuerpo)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null
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

  const importe = leerImporteDeComprobante(input.importeTexto)
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
