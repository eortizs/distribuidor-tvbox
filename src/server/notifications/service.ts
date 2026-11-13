import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { AppError } from "@/server/umejson/types"
import { formatMxn } from "@/lib/finanzas"

/**
 * Notificaciones persistentes del comprador y de los administradores:
 * resultados de renovaciones de licencias (Mercado Pago, transferencia,
 * cupón y paquetes de `/modulos/paquetes-flujotv`) y de abonos de saldo.
 * Cada aviso al comprador se replica en la cuenta de cada admin
 * (`fanoutAdminCopies`) con la atribución al distribuidor que ejecutó la
 * operación —exitosas y fallidas— para que el admin siempre se entere del
 * resultado sin depender del comprador. Cuando la validación automática
 * rechaza un comprobante de transferencia, además del aviso al comprador se
 * inserta una copia en la cuenta de cada admin
 * (`createAdminTransferRejectedNotification`) para que la campana le avise
 * de la orden pendiente de revisión. La creación es mejor esfuerzo — una
 * notificación que falla nunca revierte ni retrasa la renovación que la
 * originó; el resto de operaciones (listar, leer, borrar) sí son exigentes
 * porque las piden directamente la UI de la campana.
 */

export type NotificationKind =
  | "renewal_success"
  | "renewal_failed"
  | "transfer_rejected"
  | "alert_hit"
  | "reminder"

export interface NotificationRow {
  id: string
  kind: NotificationKind
  title: string
  body: string
  /** Cliente FlujoTV renovado (para mostrar quién fue el beneficiario). */
  user_name: string | null
  /** Vencimiento nuevo verificado en el panel (crudo, se formatea al pintar). */
  expires_at: string | null
  order_id: string | null
  read_at: string | null
  created_at: string
}

export interface NotificationFeed {
  items: NotificationRow[]
  unread: number
}

/** Tope de lote para leer/borrar por ids (igual que el resto de APIs). */
const MAX_BATCH_IDS = 200

const KINDS: readonly NotificationKind[] = [
  "renewal_success",
  "renewal_failed",
  "transfer_rejected",
  "alert_hit",
  "reminder",
]

function logError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `notifications: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return new Date(value as string).toISOString()
}

function parseRow(row: Record<string, unknown>): NotificationRow {
  return {
    id: String(row.id),
    kind: (KINDS as readonly string[]).includes(String(row.kind))
      ? (row.kind as NotificationKind)
      : "renewal_failed",
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    user_name: row.user_name === null || row.user_name === undefined
      ? null
      : String(row.user_name),
    expires_at: row.expires_at === null || row.expires_at === undefined
      ? null
      : String(row.expires_at),
    order_id: row.order_id === null || row.order_id === undefined
      ? null
      : String(row.order_id),
    read_at: isoOrNull(row.read_at),
    created_at: new Date(row.created_at as string).toISOString(),
  }
}

/** Forma canónica de un id de notificación (columna uuid). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Selección de notificaciones para leer/borrar: sin clave `ids` en el cuerpo
 * = todas; con `ids` = lote explícito de UUIDs. Cualquier otra forma se
 * rechaza: un array inválido o sobredimensionado NUNCA se degrada a «todas»
 * (sería borrar o marcar el feed entero por una entrada malformada).
 */
export type NotificationSelection =
  | { all: true }
  | { all: false; ids: string[] }

export function parseNotificationSelection(body: unknown): NotificationSelection {
  if (typeof body !== "object" || body === null) {
    return { all: true }
  }
  const { ids } = body as Record<string, unknown>
  if (ids === undefined) {
    return { all: true }
  }
  const valid =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= MAX_BATCH_IDS &&
    ids.every((id) => typeof id === "string" && UUID_RE.test(id))
  if (!valid) {
    throw new AppError(
      422,
      "invalid_request",
      `ids debe ser un array de 1 a ${MAX_BATCH_IDS} UUID válidos; omite la clave para aplicar a todas.`
    )
  }
  return { all: false, ids: ids as string[] }
}

export interface RenewalNotificationInput {
  /** Destinatario: comprador de la orden (`mp_orders.buyer_user_id`). */
  buyerUserId: string | null
  kind: NotificationKind
  /** Cliente FlujoTV renovado (o username del comprador en un abono). */
  userName: string
  /**
   * Meses de la renovación; `0` marca un abono de saldo
   * (`/modulos/abonar-saldo`): los textos de abajo usan la rama de abono.
   */
  months: number
  /** Monto del abono (solo con `months = 0`), para el cuerpo del aviso. */
  amountMxn?: number
  /**
   * Billetera destino del abono (`months = 0`): tokens o cupones. Falta en
   * los abonos legados y se lee como cupones.
   */
  saldoTipo?: "tokens" | "cupones"
  /** Meses gratis del paquete (0 en renovaciones individuales). */
  bonusMonths?: number
  /** Vencimiento nuevo verificado en el panel (solo éxito). */
  verifiedExpiresAt?: string | null
  /** Motivo del fallo o del rechazo, para el cuerpo. */
  error?: string | null
  orderId: string | null
}

/**
 * Crea la notificación de resultado de renovación para el comprador y, con
 * `fanoutAdminCopies`, replica el resultado en la campana de cada admin con
 * la atribución al distribuidor. Nunca lanza: el flujo de cobro/renovación
 * que la invoca no debe enterarse de un fallo de aviso (se registra y se
 * sigue).
 */
export function createRenewalNotification(
  input: RenewalNotificationInput
): void {
  const { buyerUserId, kind, userName, months, orderId } = input
  if (!buyerUserId) return

  // Abono de saldo (months = 0): el aviso habla del saldo acreditado, no de
  // una renovación de licencia. Mismos kinds para reutilizar el feed, los
  // badges de la campana y la deduplicación por orden.
  if (months === 0) {
    const amount =
      typeof input.amountMxn === "number" && input.amountMxn > 0
        ? formatMxn(input.amountMxn)
        : ""
    // Billetera destino nombrada en el texto (cupones si no llegó el campo,
    // el saldo histórico era para licencias).
    const billetera =
      input.saldoTipo === "tokens" ? "tu saldo en tokens" : "tu saldo en cupones"
    let title: string
    let body: string
    if (kind === "renewal_success") {
      title = "Abono aplicado"
      body = amount
        ? `Tu abono de ${amount} quedó acreditado en ${billetera}.`
        : `Tu abono quedó acreditado en ${billetera}.`
    } else {
      title = "Abono no acreditado"
      const reason = (input.error ?? "").trim()
      body =
        `El pago quedó registrado pero el abono no se pudo acreditar en ${billetera}.` +
        (reason ? ` Motivo: ${reason.slice(0, 200)}` : "") +
        " Se reintentará solo; si persiste, contacta al administrador."
    }
    void insertNotification({
      userId: buyerUserId,
      kind,
      title,
      body,
      userName,
      expiresAt: null,
      orderId,
    }).catch((error: unknown) => logError("create", error))
    fanoutAdminCopies(input)
    return
  }

  const bonusMonths =
    Number.isInteger(input.bonusMonths) && (input.bonusMonths as number) > 0
      ? (input.bonusMonths as number)
      : 0
  const paqueteLabel =
    bonusMonths > 0 ? ` +${bonusMonths} mes${bonusMonths === 1 ? "" : "es"} de regalo` : ""

  let title: string
  let body: string
  let expiresAt: string | null = null

  if (kind === "renewal_success") {
    expiresAt = input.verifiedExpiresAt ?? null
    title = "Renovación exitosa"
    // La fecha no va en el cuerpo: la UI la formatea desde `expires_at`
    // (el crudo del panel puede no ser legible).
    body = `+${months} mes${months === 1 ? "" : "es"}${paqueteLabel} para ${userName}.`
  } else if (kind === "renewal_failed") {
    title = "Renovación fallida"
    const reason = (input.error ?? "").trim()
    body =
      `No se pudo renovar la licencia de ${userName} (+${months} mes${months === 1 ? "" : "es"}).` +
      (reason ? ` Motivo: ${reason.slice(0, 200)}` : "") +
      " Puedes reintentar desde Clientes."
  } else {
    title = "Transferencia rechazada"
    const reason = (input.error ?? "").trim()
    body =
      `Tu comprobante para renovar a ${userName} no fue aceptado.` +
      (reason ? ` Motivo: ${reason.slice(0, 200)}` : "") +
      " Revisa tus datos o contacta al administrador."
  }

  void insertNotification({
    userId: buyerUserId,
    kind,
    title,
    body,
    userName,
    expiresAt,
    orderId,
  }).catch((error: unknown) => logError("create", error))
  fanoutAdminCopies(input)
}

/**
 * Textos de la copia para admins: mismos `kind` (badges e iconos de la
 * campana) pero en tercera persona y atribuidos al distribuidor que ejecutó
 * la operación, para que el admin distinga de un vistazo quién la hizo.
 */
function adminCopyTexts(
  input: RenewalNotificationInput,
  distributor: string
): { title: string; body: string } {
  const reason = (input.error ?? "").trim()

  // Abono de saldo (months = 0): la copia habla del abono del distribuidor.
  if (input.months === 0) {
    const amount =
      typeof input.amountMxn === "number" && input.amountMxn > 0
        ? formatMxn(input.amountMxn)
        : ""
    const billetera =
      input.saldoTipo === "tokens" ? "su saldo en tokens" : "su saldo en cupones"
    if (input.kind === "renewal_success") {
      return {
        title: "Abono aplicado",
        body: `Distribuidor ${distributor} abonó ${
          amount || "un monto"
        } a ${billetera}.`,
      }
    }
    return {
      title: "Abono no acreditado",
      body:
        `El pago de ${distributor} quedó registrado pero el abono no se pudo acreditar en ${billetera}.` +
        (reason ? ` Motivo: ${reason.slice(0, 200)}` : "") +
        " Queda marcada para reintento automático.",
    }
  }

  const bonusMonths =
    Number.isInteger(input.bonusMonths) && (input.bonusMonths as number) > 0
      ? (input.bonusMonths as number)
      : 0
  const paqueteLabel =
    bonusMonths > 0
      ? ` +${bonusMonths} mes${bonusMonths === 1 ? "" : "es"} de regalo`
      : ""

  if (input.kind === "renewal_success") {
    return {
      title: "Renovación exitosa",
      body: `Distribuidor ${distributor} renovó +${input.months} mes${
        input.months === 1 ? "" : "es"
      }${paqueteLabel} para ${input.userName}.`,
    }
  }
  if (input.kind === "renewal_failed") {
    return {
      title: "Renovación fallida",
      body:
        `Distribuidor ${distributor} no pudo renovar la licencia de ${input.userName} (+${input.months} mes${
          input.months === 1 ? "" : "es"
        }).` +
        (reason ? ` Motivo: ${reason.slice(0, 200)}` : "") +
        " Puedes reintentar desde Clientes.",
    }
  }
  return {
    title: "Transferencia rechazada",
    body:
      `Se rechazó el comprobante de ${distributor} para renovar a ${input.userName}.` +
      (reason ? ` Motivo: ${reason.slice(0, 200)}` : ""),
  }
}

/**
 * Replica el resultado de la operación del distribuidor en la campana de
 * cada administrador (exitosas y fallidas): el admin se entera de lo que ya
 * le llegó al comprador, con la atribución de quién la ejecutó. Sin buyer no
 * hay operación que atribuir (legado). El admin que ES el comprador no
 * recibe copia (ya tiene la notificación propia; duplicar sería ruido). El
 * índice único parcial (user_id, order_id) para fallos/rechazos deduplica
 * contra la copia de revisión de `createAdminTransferRejectedNotification`.
 * Nunca lanza: mismo contrato de mejor esfuerzo que el aviso al comprador.
 */
function fanoutAdminCopies(input: RenewalNotificationInput): void {
  const { buyerUserId, orderId } = input
  if (!buyerUserId) return

  void Promise.all([
    pool.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`),
    pool.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1::uuid`,
      [buyerUserId]
    ),
  ])
    .then(([admins, buyer]) => {
      const distributor = (buyer.rows[0]?.username ?? "").trim() ||
        "un distribuidor"
      const { title, body } = adminCopyTexts(input, distributor)
      const targets = admins.rows
        .map((row) => String(row.id))
        .filter((adminId) => adminId !== buyerUserId)
      return Promise.all(
        targets.map((adminId) =>
          insertNotification({
            userId: adminId,
            kind: input.kind,
            title,
            body,
            userName: input.userName,
            expiresAt:
              input.kind === "renewal_success" && input.months > 0
                ? (input.verifiedExpiresAt ?? null)
                : null,
            orderId,
          })
        )
      )
    })
    .catch((error: unknown) => logError("create_admin_copies", error))
}

export interface AdminTransferRejectedNotificationInput {
  /** Orden de transferencia que quedó `pending` para revisión manual. */
  orderId: string
  /** Cliente FlujoTV que se quería renovar. */
  userName: string
  /** Motivos del rechazo automático del comprobante (ya legibles). */
  reasons: string[]
}

/**
 * Copia del rechazo automático de un comprobante en la campana de cada
 * administrador: la orden quedó `pending` en «Transferencias por revisar» y
 * el admin se entera sin depender de abrir el listado. Los motivos llegan
 * con el detalle de cada condición (esperado vs leído) para contextualizar
 * la revisión. Nunca lanza: mismo contrato de mejor esfuerzo que
 * `createRenewalNotification`.
 */
export function createAdminTransferRejectedNotification(
  input: AdminTransferRejectedNotificationInput
): void {
  const userName = input.userName.trim()
  if (!userName || !input.orderId) return

  const reasons = input.reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)
    .slice(0, 6)
  const detail = reasons.join("; ").slice(0, 400)

  const title = "Transferencia por revisar"
  const body =
    `El comprobante para renovar a ${userName} no pasó la validación automática.` +
    (detail
      ? ` Motivo${reasons.length === 1 ? "" : "s"}: ${detail}.`
      : "") +
    " Revísala en Transferencias por revisar."

  void pool
    .query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)
    .then((result) =>
      Promise.all(
        result.rows.map((row) =>
          insertNotification({
            userId: String(row.id),
            kind: "transfer_rejected",
            title,
            body,
            userName,
            expiresAt: null,
            orderId: input.orderId,
          })
        )
      )
    )
    .catch((error: unknown) => logError("create_admin_transfer", error))
}

export interface AlertNotificationInput {
  userId: string
  kind: Extract<NotificationKind, "alert_hit" | "reminder">
  title: string
  body: string
}

/**
 * Aviso de campana del módulo Alertas (hallazgo, recordatorio o alerta
 * pausada por errores): mejor esfuerzo, igual que los avisos de renovación,
 * y con su propio disparo SSE para que la campana se refresque en vivo. El
 * dedup vive en el módulo (huella del hallazgo), así que va sin `order_id`.
 */
export function createAlertNotification(input: AlertNotificationInput): void {
  void insertNotification({
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    userName: "",
    expiresAt: null,
    orderId: null,
  }).catch((error: unknown) => logError("create_alert", error))
}

interface NotificationInsert {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  userName: string
  expiresAt: string | null
  orderId: string | null
}

/**
 * Inserta la fila y avisa por SSE al destinatario solo cuando realmente se
 * escribió (un fallo deduplicado no debe refrescar la campana de nuevo). El
 * índice único parcial sobre (user_id, order_id) para fallos y rechazos
 * garantiza una sola notificación por orden y destinatario aunque los
 * intentos se solapen (webhooks at-least-once, reintento + conciliación,
 * re-escaneo de la misma orden).
 */
function insertNotification(insert: NotificationInsert): Promise<boolean> {
  return pool
    .query(
      `INSERT INTO notifications
         (id, user_id, kind, title, body, user_name, expires_at, order_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, order_id)
         WHERE order_id IS NOT NULL
           AND kind IN ('renewal_failed', 'transfer_rejected')
       DO NOTHING`,
      [
        randomUUID(),
        insert.userId,
        insert.kind,
        insert.title,
        insert.body,
        insert.userName,
        insert.expiresAt,
        insert.orderId,
      ]
    )
    .then((result) => {
      if ((result.rowCount ?? 0) > 0) {
        publishRealtimeDetached({
          kind: "notifications",
          entityId: insert.orderId ?? undefined,
          distribuidorId: insert.userId,
        })
        return true
      }
      return false
    })
}

const FEED_LIMIT = 30

/** Feed de la campana: últimas notificaciones + contador de no leídas. */
export async function listNotifications(
  userId: string,
  limit: number = FEED_LIMIT
): Promise<NotificationFeed> {
  const capped = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 100)
    : FEED_LIMIT
  const [items, unread] = await Promise.all([
    pool
      .query(
        `SELECT id, kind, title, body, user_name, expires_at, order_id,
                read_at, created_at
           FROM notifications
          WHERE user_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, capped]
      )
      .then((result) => result.rows.map(parseRow)),
    countUnread(userId),
  ])
  return { items, unread }
}

/** Contador de no leídas: única definición compartida por feed y acciones. */
function countUnread(userId: string): Promise<number> {
  return pool
    .query<{ unread: number }>(
      `SELECT count(*)::int AS unread
         FROM notifications
        WHERE user_id = $1::uuid AND read_at IS NULL`,
      [userId]
    )
    .then((result) => result.rows[0]?.unread ?? 0)
}

/**
 * Marca como leídas las notificaciones de `selection` (lote de ids o todas).
 * Devuelve el contador de no leídas restante.
 */
export async function markNotificationsRead(
  userId: string,
  selection: NotificationSelection
): Promise<number> {
  if (selection.all) {
    await pool.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE user_id = $1::uuid AND read_at IS NULL`,
      [userId]
    )
  } else {
    await pool.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE user_id = $1::uuid AND read_at IS NULL AND id = ANY($2::uuid[])`,
      [userId, selection.ids]
    )
  }
  return countUnread(userId)
}

/**
 * Borra las notificaciones de `selection` (lote de ids o todas). Devuelve el
 * contador de no leídas restante (las borradas dejaron de contar).
 */
export async function deleteNotifications(
  userId: string,
  selection: NotificationSelection
): Promise<number> {
  if (selection.all) {
    await pool.query(`DELETE FROM notifications WHERE user_id = $1::uuid`, [
      userId,
    ])
  } else {
    await pool.query(
      `DELETE FROM notifications
        WHERE user_id = $1::uuid AND id = ANY($2::uuid[])`,
      [userId, selection.ids]
    )
  }
  return countUnread(userId)
}
