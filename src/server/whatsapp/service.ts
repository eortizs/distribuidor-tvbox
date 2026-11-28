import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

import type { UserRole } from "@/server/auth/types"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import { findTenantById, tenantIdOfUser } from "@/server/tenant/context"
import { fillPayerNamesForPhone } from "@/server/links-pago/repository"
import { normalizePaymentOrderPayerName } from "@/lib/links-pago"

import {
  canonicalWhatsAppDigits,
  isValidWhatsAppNumber,
  normalizeWhatsAppDigits,
  whatsappAgentNumber,
} from "./config"
import { shouldMirrorToUser } from "./tenant-routing"

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
  role: UserRole
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
    role: UserRole
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
 * Kind de los avisos DIRECTOS a clientes FlujoTV (renovación por WhatsApp).
 * Los clientes no son usuarios del panel: el dispatcher omite el link al
 * panel para este kind (outbox.ts). Fuente única del literal: lo comparten
 * el escritor de la cola y el dispatcher.
 */
export const WHATSAPP_KIND_CLIENT_RENEWAL = "client_renewal"

/**
 * Kind de los avisos DIRECTOS al PAGADOR de una orden de pago
 * (/modulos/links-de-pago): cualquier persona sin cuenta en el panel, igual
 * que los clientes; el dispatcher omite el link al panel para este kind.
 */
export const WHATSAPP_KIND_PAYMENT_ORDER = "payment_order"

/** Inserta la fila de salida compartida por todos los escritores de la cola. */
async function insertOutboxRow(input: {
  userId: string
  notificationId: string | null
  phone: string
  kind: string | null
  title: string
  body: string
  attachment?: { path: string; name: string; mime: string } | null
}): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO wa_outbox
         (id, user_id, notification_id, phone, title, body, kind,
          file_path, file_name, file_mime)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        input.userId,
        input.notificationId,
        input.phone,
        input.title,
        input.body,
        input.kind,
        input.attachment?.path ?? null,
        input.attachment?.name ?? null,
        input.attachment?.mime ?? null,
      ]
    )
    return true
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `whatsapp: enqueue: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    )
    return false
  }
}

/**
 * Número de WhatsApp DEL TENANT actual (el dueño del socket que serviría el
 * espejo): el legado usa el del env; un negocio el declarado. Null = sin
 * número (fuera del canal).
 */
async function tenantOwnNumber(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null
  if (tenantId === LEGACY_TENANT_ID) return whatsappAgentNumber()
  const tenant = await findTenantById(tenantId).catch(() => null)
  return tenant?.whatsappNumber ?? null
}

/**
 * Encola una copia de notificación para el WhatsApp registrado del usuario.
 * Sin número registrado no hace nada (la mayoría de los usuarios: cero
 * escrituras). Devuelve true si quedó encolada. Los errores se registran y
 * se tragan: la notificación que la originó no debe enterarse.
 *
 * AUTO-CHAT (§4.5 2B): si el WhatsApp registrado del usuario ES el número de
 * SU tenant (el dueño probando su propio negocio), no se encola su espejo —
 * el socket no puede entregarse un mensaje a sí mismo.
 */
export async function enqueueWhatsAppForUser(
  input: EnqueueWhatsAppInput
): Promise<boolean> {
  const phone = await getWhatsAppPhoneOf(input.userId)
  if (!phone) return false
  // Tenant del DESTINATARIO (fuente única users.tenant_id, cache 30 s): el
  // contexto ALS sync devuelve null en las continuaciones HTTP tras los
  // awaits de Next (hallazgo 2026-11-24) — la supresión del auto-chat debe
  // ser determinista por destinatario, no dependiente del escritor.
  const own = await tenantOwnNumber(await tenantIdOfUser(input.userId))
  if (!shouldMirrorToUser({ userPhone: phone, tenantNumber: own })) {
    return false
  }
  return insertOutboxRow({
    userId: input.userId,
    notificationId: input.notificationId,
    phone,
    kind: input.kind,
    title: input.title,
    body: input.body,
  })
}

/**
 * Igual que `enqueueWhatsAppForUser`, pero con el teléfono EXPLÍCITO: es la
 * vía de los avisos a CLIENTES de FlujoTV (no son usuarios; su número vive
 * en `client_metadata`). El teléfono debe venir ya en forma de envío (solo
 * dígitos con código de país).
 */
export async function enqueueWhatsAppForPhone(input: {
  userId: string
  phone: string
  kind: string | null
  title: string
  body: string
  /** Imagen adjunta (ticket de compra PNG): la fila se entrega como imagen
   * de WhatsApp con `title\nbody` de caption. En ruta de disco para que los
   * reintentos del dispatcher sobrevivan a un reinicio del proceso. */
  attachment?: { path: string; name: string; mime: string } | null
}): Promise<boolean> {
  if (input.phone.length === 0) return false
  return insertOutboxRow({
    userId: input.userId,
    notificationId: null,
    phone: input.phone,
    kind: input.kind,
    title: input.title,
    body: input.body,
    attachment: input.attachment ?? null,
  })
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

export interface WhatsAppContactRow {
  id: string
  phone: string
  pushName: string | null
  firstSeenAt: string
  lastSeenAt: string
  inboundCount: number
}

export async function registerWhatsAppContact(input: {
  phone: string
  pushName?: string | null
}): Promise<void> {
  const name = normalizePaymentOrderPayerName(input.pushName)
  await pool.query(
    `INSERT INTO wa_contacts (phone, push_name, inbound_count)
     VALUES ($1, $2::text, 1)
     ON CONFLICT (tenant_id, phone) DO UPDATE
        SET last_seen_at = now(),
            inbound_count = wa_contacts.inbound_count + 1,
            push_name = COALESCE(wa_contacts.push_name, EXCLUDED.push_name),
            updated_at = now()`,
    [input.phone, name]
  )
  if (name) await fillPayerNamesForPhone(input.phone, name)
}

export function registerWhatsAppContactDetached(input: {
  phone: string
  pushName?: string | null
}): void {
  void registerWhatsAppContact(input).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `whatsapp: contact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  })
}

export async function listWhatsAppContacts(
  limit = 200
): Promise<WhatsAppContactRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, phone, push_name, first_seen_at, last_seen_at, inbound_count
       FROM wa_contacts
      ORDER BY last_seen_at DESC
      LIMIT $1`,
    [capped]
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    phone: String(row.phone),
    pushName: typeof row.push_name === "string" ? row.push_name : null,
    firstSeenAt: new Date(row.first_seen_at as string).toISOString(),
    lastSeenAt: new Date(row.last_seen_at as string).toISOString(),
    inboundCount: Number(row.inbound_count ?? 0),
  }))
}
