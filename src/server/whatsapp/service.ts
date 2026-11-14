import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

import {
  canonicalWhatsAppDigits,
  isValidWhatsAppNumber,
  normalizeWhatsAppDigits,
} from "./config"

/**
 * Persistencia del módulo WhatsApp: cola de salida (`wa_outbox`), bitácora
 * (`wa_message_log`) y registro de números (`users.whatsapp_phone`).
 *
 * Contrato central: **el espejo de notificaciones nunca lanza ni bloquea**.
 * `enqueueWhatsAppForUserDetached` es fire-and-forget (patrón
 * `pushToUserDetached`): si la cola falla, la campana y el push siguen
 * funcionando igual.
 */

/** Usuario resuelto desde un número de WhatsApp registrado. */
export interface WhatsAppUser {
  id: string
  username: string
  role: "admin" | "distribuidor"
  whatsappPhone: string
}

export async function findUserByWhatsAppPhone(
  phone: string
): Promise<WhatsAppUser | null> {
  // Ambas formas mexicanas (52+10 y 521+10): el registro puede venir en una
  // y el JID entrante en la otra — canonicalizar el lookup no basta si la
  // fila fue guardada antes de la canonicalización.
  const canonical = canonicalWhatsAppDigits(phone)
  const result = await pool.query<{
    id: string
    username: string
    role: "admin" | "distribuidor"
    whatsapp_phone: string
  }>(
    `SELECT id, username, role, whatsapp_phone
       FROM users
      WHERE whatsapp_phone = ANY($1)`,
    [canonical === phone ? [phone] : [phone, canonical]]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    username: String(row.username),
    role: row.role,
    whatsappPhone: String(row.whatsapp_phone),
  }
}

/** Teléfono WhatsApp registrado de un usuario; null si no lo tiene. */
export async function getWhatsAppPhoneOf(
  userId: string
): Promise<string | null> {
  const result = await pool.query<{ whatsapp_phone: string | null }>(
    `SELECT whatsapp_phone FROM users WHERE id = $1::uuid`,
    [userId]
  )
  const raw = result.rows[0]?.whatsapp_phone
  return typeof raw === "string" && raw.length > 0 ? raw : null
}

export interface EnqueueWhatsAppInput {
  userId: string
  notificationId: string | null
  kind: string | null
  title: string
  body: string
}

/**
 * Encola una copia de notificación para el WhatsApp registrado del usuario.
 * Sin número registrado no hace nada (la mayoría de los usuarios: cero
 * escrituras). Devuelve true si quedó encolada. Los errores se registran y
 * se tragan: la notificación que la originó no debe enterarse.
 */
export async function enqueueWhatsAppForUser(
  input: EnqueueWhatsAppInput
): Promise<boolean> {
  try {
    const phone = await getWhatsAppPhoneOf(input.userId)
    if (!phone) return false
    await pool.query(
      `INSERT INTO wa_outbox
         (id, user_id, notification_id, phone, title, body, kind)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.userId,
        input.notificationId,
        phone,
        input.title,
        input.body,
        input.kind,
      ]
    )
    return true
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `whatsapp: enqueue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
    return false
  }
}

/** Igual que `enqueueWhatsAppForUser`, sin esperar el resultado. */
export function enqueueWhatsAppForUserDetached(
  input: EnqueueWhatsAppInput
): void {
  void enqueueWhatsAppForUser(input)
}

/**
 * Fija (o quita con null) el WhatsApp registrado de un usuario. Normaliza a
 * dígitos con código de país y valida 10–15. El índice único parcial
 * (`users_whatsapp_phone_uidx`) garantiza un número = una cuenta: el choque
 * se traduce a 409 con mensaje útil.
 */
export async function setWhatsAppPhone(
  userId: string,
  rawPhone: string | null
): Promise<string | null> {
  const normalized =
    rawPhone === null || rawPhone.trim() === ""
      ? null
      : canonicalWhatsAppDigits(normalizeWhatsAppDigits(rawPhone))
  if (normalized !== null && !isValidWhatsAppNumber(normalized)) {
    throw new AppError(
      422,
      "whatsapp_phone_invalido",
      "Introduce un número de WhatsApp válido con código de país (11 a 15 dígitos; p. ej. 525540049353)."
    )
  }
  try {
    await pool.query(`UPDATE users SET whatsapp_phone = $2 WHERE id = $1::uuid`, [
      userId,
      normalized,
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("users_whatsapp_phone_uidx") || message.includes("duplicate key")) {
      throw new AppError(
        409,
        "whatsapp_phone_duplicado",
        "Ese número de WhatsApp ya está registrado en otra cuenta."
      )
    }
    throw error
  }
  return normalized
}

/** Bitácora de un mensaje (entrante o saliente); nunca lanza. */
export function logWhatsAppMessageDetached(input: {
  direction: "in" | "out"
  userId: string | null
  phone: string
  text: string
  meta?: Record<string, unknown>
}): void {
  void pool
    .query(
      `INSERT INTO wa_message_log (direction, user_id, phone, text, meta)
       VALUES ($1, $2::uuid, $3, $4, $5::jsonb)`,
      [
        input.direction,
        input.userId,
        input.phone,
        input.text.slice(0, 4000),
        input.meta ? JSON.stringify(input.meta) : null,
      ]
    )
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `whatsapp: log: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    })
}

export interface WhatsAppOutboxRow {
  id: string
  userId: string
  username: string | null
  phone: string
  kind: string | null
  title: string
  body: string
  status: "pending" | "sending" | "sent" | "failed"
  attempts: number
  nextAttemptAt: string | null
  lastError: string | null
  createdAt: string
  sentAt: string | null
}

/** Cola de salida para el módulo admin (pendientes y fallidos primero). */
export async function listWhatsAppOutbox(limit = 50): Promise<
  WhatsAppOutboxRow[]
> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 200)
  const result = await pool.query<Record<string, unknown>>(
    `SELECT o.id, o.user_id, u.username, o.phone, o.kind, o.title, o.body,
            o.status, o.attempts, o.next_attempt_at, o.last_error,
            o.created_at, o.sent_at
       FROM wa_outbox o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status <> 'sent'
      ORDER BY o.created_at DESC
      LIMIT $1`,
    [capped]
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    username: typeof row.username === "string" ? row.username : null,
    phone: String(row.phone),
    kind: typeof row.kind === "string" ? row.kind : null,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    status: row.status as WhatsAppOutboxRow["status"],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: row.next_attempt_at
      ? new Date(row.next_attempt_at as string).toISOString()
      : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
  }))
}

/** Reencola un envío fallido o varado: reintento completo desde cero. */
export async function retryWhatsAppOutboxItem(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE wa_outbox
        SET status = 'pending', attempts = 0, next_attempt_at = now(),
            last_error = NULL
      WHERE id = $1::uuid AND status IN ('failed', 'sending')`,
    [id]
  )
  return (result.rowCount ?? 0) > 0
}

export interface WhatsAppLogRow {
  id: number
  direction: "in" | "out"
  username: string | null
  phone: string
  text: string
  meta: Record<string, unknown> | null
  createdAt: string
}

/** Últimos mensajes de la bitácora (auditivo del módulo admin). */
export async function listWhatsAppLog(limit = 50): Promise<WhatsAppLogRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 200)
  const result = await pool.query<Record<string, unknown>>(
    `SELECT l.id, l.direction, u.username, l.phone, l.text, l.meta, l.created_at
       FROM wa_message_log l
       LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC
      LIMIT $1`,
    [capped]
  )
  return result.rows.map((row) => ({
    id: Number(row.id),
    direction: row.direction === "in" ? "in" : "out",
    username: typeof row.username === "string" ? row.username : null,
    phone: String(row.phone),
    text: String(row.text ?? ""),
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }))
}
