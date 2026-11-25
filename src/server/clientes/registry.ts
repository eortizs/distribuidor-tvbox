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
  /** Correo del usuario dueño (quien lo creó); null si el alta quedó huérfana. */
  ownerEmail: string | null
  createdAt: Date
  updatedAt: Date
  /** Cantidad de links de pago asociados (para la vista). */
  linkCount: number
}

/**
 * Alcance del VISOR sobre el registro (fase 2 de la segmentación de
 * clientes, 2026-11-24): la sucursal solo ve/gestiona SUS clientes (dueño =
 * quien lo crea); el propietario ve todos los del negocio, agrupados por
 * sucursal. El aislamiento por tenant sigue en RLS: esto es la capa de
 * perfil encima.
 */
export interface ClientScope {
  userId: string
  /** true para sucursal: filtra por sus propios clientes y acota escritura. */
  branchScoped: boolean
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
         owner.username AS owner_email,
         (SELECT count(*)::int FROM payment_orders po
            WHERE po.client_id = c.id) AS link_count
    FROM clients c
    LEFT JOIN users owner ON owner.id = c.created_by`

function mapRow(row: Record<string, unknown>): ClientRow {
  return {
    id: String(row.id),
    name: String(row.name),
    whatsappPhone: (row.whatsapp_phone as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: row.status === "archived" ? "archived" : "active",
    createdBy: (row.created_by as string | null) ?? null,
    ownerEmail: (row.owner_email as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    linkCount: Number(row.link_count ?? 0),
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Clientes ACTIVOS visibles para el visor (RLS tenant + filtro por perfil). */
export async function listClients(
  query: string | undefined,
  includeArchived = false,
  scope?: ClientScope
): Promise<ClientRow[]> {
  const trimmed = query?.trim() ?? ""
  const params: unknown[] = []
  const conditions: string[] = []
  if (!includeArchived) {
    params.push("active")
    conditions.push(`c.status = $${params.length}`)
  }
  if (scope?.branchScoped) {
    // Sucursal: solo SUS clientes (dueño = quien lo crea).
    params.push(scope.userId)
    conditions.push(`c.created_by = $${params.length}::uuid`)
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

export async function getClient(
  id: string,
  scope?: ClientScope
): Promise<ClientRow | null> {
  let where = "c.id = $1::uuid"
  const params: unknown[] = [id]
  if (scope?.branchScoped) {
    // Sucursal: un cliente ajeno NO existe para ella (sin oráculo).
    params.push(scope.userId)
    where += " AND c.created_by = $2::uuid"
  }
  const result = await pool.query(`${SELECT_COLUMNS} WHERE ${where}`, params)
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
  input: UpdateClientInput,
  scope?: ClientScope
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
    // Sin campos que tocar, la guarda de dueño sigue aplicando para la
    // sucursal (el id ajeno responde 404 igual que uno inexistente).
    const current = await getClient(id, scope)
    if (!current) throw new AppError(404, "cliente_no_encontrado", "El cliente no existe.")
    return current
  }
  // El dueño jamás cambia en un PATCH. Sucursal: solo puede editar SUS
  // clientes — un id ajeno responde 404 sin oráculo.
  sets.push("updated_at = now()")
  values.push(id)
  let where = `id = $${values.length}::uuid`
  if (scope?.branchScoped) {
    values.push(scope.userId)
    where += ` AND created_by = $${values.length}::uuid`
  }
  const result = await pool.query(
    `UPDATE clients SET ${sets.join(", ")} WHERE ${where} RETURNING id`,
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
export async function archiveClient(id: string, scope?: ClientScope): Promise<void> {
  // Sucursal: solo archiva SUS clientes (id ajeno responde 404 sin oráculo).
  let where = "id = $1::uuid AND status = 'active'"
  const params: unknown[] = [id]
  if (scope?.branchScoped) {
    params.push(scope.userId)
    where += " AND created_by = $2::uuid"
  }
  const result = await pool.query(
    `UPDATE clients SET status = 'archived', updated_at = now()
      WHERE ${where} RETURNING id`,
    params
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
