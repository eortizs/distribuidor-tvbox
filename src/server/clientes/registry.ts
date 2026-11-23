import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/**
 * Registro local de clientes (Fase 3, §3.5 del plan): clientes PROPIOS de un
 * tenant de negocio — nombre, WhatsApp y notas; SIN vencimientos ni
 * renovaciones (eso es el FlujoTV del legado). Un link de pago puede
 * asociarse de forma opcional (payment_orders.client_id). El aislamiento es
 * por RLS: las consultas corren bajo el contexto del tenant y devuelven
 * solo SUS filas.
 */

export const CLIENT_NAME_MAX = 100
export const CLIENT_WHATSAPP_MIN = 8
export const CLIENT_WHATSAPP_MAX = 15
export const CLIENT_NOTES_MAX = 2000

export interface ClientRow {
  id: string
  name: string
  whatsappPhone: string | null
  notes: string | null
  status: "active" | "archived"
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  /** Cantidad de links de pago asociados (para la vista). */
  linkCount: number
}

function normalizeWhatsappPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "")
  return digits.length > 0 ? (raw.trim().startsWith("+") ? `+${digits}` : digits) : ""
}

function validarNombre(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > CLIENT_NAME_MAX) {
    throw new AppError(
      422,
      "nombre_invalido",
      `El nombre debe tener entre 1 y ${CLIENT_NAME_MAX} caracteres.`
    )
  }
  return trimmed
}

function validarWhatsapp(raw: string | null): string | null {
  if (raw === null || raw.trim().length === 0) return null
  const normalized = normalizeWhatsappPhone(raw)
  if (
    normalized.replace(/\D/g, "").length < CLIENT_WHATSAPP_MIN ||
    normalized.replace(/\D/g, "").length > CLIENT_WHATSAPP_MAX
  ) {
    throw new AppError(
      422,
      "whatsapp_invalido",
      `El WhatsApp debe tener entre ${CLIENT_WHATSAPP_MIN} y ${CLIENT_WHATSAPP_MAX} dígitos (con código de país).`
    )
  }
  return normalized
}

function validarNotas(notes: string | null): string | null {
  if (notes === null) return null
  if (notes.length > CLIENT_NOTES_MAX) {
    throw new AppError(
      422,
      "notas_invalidas",
      `Las notas no pueden exceder ${CLIENT_NOTES_MAX} caracteres.`
    )
  }
  return notes.length > 0 ? notes : null
}

const SELECT_COLUMNS = `
  SELECT c.id, c.name, c.whatsapp_phone, c.notes, c.status, c.created_by,
         c.created_at, c.updated_at,
         (SELECT count(*)::int FROM payment_orders po
           WHERE po.client_id = c.id) AS link_count
    FROM clients c`

function mapRow(row: Record<string, unknown>): ClientRow {
  return {
    id: String(row.id),
    name: String(row.name),
    whatsappPhone: (row.whatsapp_phone as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: row.status === "archived" ? "archived" : "active",
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    linkCount: Number(row.link_count ?? 0),
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Clientes ACTIVOS del tenant (RLS), búsqueda opcional por nombre/WhatsApp. */
export async function listClients(
  query: string | undefined,
  includeArchived = false
): Promise<ClientRow[]> {
  const trimmed = query?.trim() ?? ""
  const params: unknown[] = []
  const conditions: string[] = []
  if (!includeArchived) {
    params.push("active")
    conditions.push(`c.status = $${params.length}`)
  }
  if (trimmed.length >= 2) {
    params.push(`%${escapeLike(trimmed)}%`)
    conditions.push(
      `(c.name ILIKE $${params.length} OR c.whatsapp_phone ILIKE $${params.length})`
    )
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  params.push(200)
  const result = await pool.query(
    `${SELECT_COLUMNS} ${where} ORDER BY c.name ASC LIMIT $${params.length}`,
    params
  )
  return result.rows.map(mapRow)
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const result = await pool.query(`${SELECT_COLUMNS} WHERE c.id = $1::uuid`, [id])
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export interface CreateClientInput {
  name: string
  whatsappPhone?: string | null
  notes?: string | null
  createdBy: string
}

export async function createClient(input: CreateClientInput): Promise<ClientRow> {
  const name = validarNombre(input.name)
  const whatsapp = validarWhatsapp(input.whatsappPhone ?? null)
  const notes = validarNotas(input.notes ?? null)
  const result = await pool.query(
    `INSERT INTO clients (id, name, whatsapp_phone, notes, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid)
     RETURNING id`,
    [randomUUID(), name, whatsapp, notes, input.createdBy]
  )
  notifyClientsChanged()
  const created = await getClient(String(result.rows[0].id))
  if (!created) throw new AppError(500, "cliente_no_creado", "No se pudo crear el cliente.")
  return created
}

export interface UpdateClientInput {
  name?: string
  whatsappPhone?: string | null
  notes?: string | null
}

/** PATCH compare-and-swap libre (sin versión: dominio simple). */
export async function updateClient(
  id: string,
  input: UpdateClientInput
): Promise<ClientRow> {
  const sets: string[] = []
  const values: unknown[] = []
  if (input.name !== undefined) {
    values.push(validarNombre(input.name))
    sets.push(`name = $${values.length}`)
  }
  if (input.whatsappPhone !== undefined) {
    values.push(validarWhatsapp(input.whatsappPhone))
    sets.push(`whatsapp_phone = $${values.length}`)
  }
  if (input.notes !== undefined) {
    values.push(validarNotas(input.notes))
    sets.push(`notes = $${values.length}`)
  }
  if (sets.length === 0) {
    const current = await getClient(id)
    if (!current) throw new AppError(404, "cliente_no_encontrado", "El cliente no existe.")
    return current
  }
  sets.push("updated_at = now()")
  values.push(id)
  const result = await pool.query(
    `UPDATE clients SET ${sets.join(", ")} WHERE id = $${values.length}::uuid RETURNING id`,
    values
  )
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, "cliente_no_encontrado", "El cliente no existe.")
  }
  notifyClientsChanged()
  const updated = await getClient(id)
  if (!updated) throw new AppError(404, "cliente_no_encontrado", "El cliente no existe.")
  return updated
}

/** Archivar (borrado suave): los links asociados conservan el histórico. */
export async function archiveClient(id: string): Promise<void> {
  const result = await pool.query(
    `UPDATE clients SET status = 'archived', updated_at = now()
      WHERE id = $1::uuid AND status = 'active' RETURNING id`,
    [id]
  )
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, "cliente_no_encontrado", "El cliente no existe o ya está archivado.")
  }
  notifyClientsChanged()
}

/** Señal SSE `clients` (bus realtime): el listado se refresca en vivo. */
function notifyClientsChanged(): void {
  import("@/server/realtime/bus").then(({ publishRealtimeDetached }) =>
    publishRealtimeDetached({ kind: "clients" })
  ).catch(() => undefined)
}
