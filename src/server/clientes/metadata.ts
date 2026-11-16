import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"

/**
 * Metadatos locales de un cliente FlujoTV (/clientes), llave por usuario del
 * panel (en minúsculas, tabla `client_metadata`). El panel es la fuente del
 * listado y de los pagos; aquí solo vive lo propio de la app:
 *
 * - `alias`: nombre propio editable del cliente (el nombre del panel viene
 *   de la columna Notas y es de solo lectura).
 * - `whatsappPhone`: WhatsApp de contacto del cliente.
 * - `priceMxn`: precio especial de la licencia para ese cliente (MXN); null
 *   = usa el precio general del servidor (`LICENSE_PRICE_MXN`).
 */

export interface ClientMetadata {
  userName: string
  alias: string | null
  whatsappPhone: string | null
  priceMxn: number | null
  updatedAt: string | null
}

/** Tope de caracteres del alias. */
export const CLIENT_META_ALIAS_MAX = 80

/** Tope de caracteres del WhatsApp (formato libre normalizable a dígitos). */
export const CLIENT_META_WHATSAPP_MAX = 24

/** Tope del precio especial (MXN). */
export const CLIENT_META_PRICE_MAX = 999_999.99

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/

function normalizeUserName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!USERNAME_RE.test(value)) {
    throw new AppError(
      422,
      "validation_error",
      "El nombre de usuario del cliente no es válido."
    )
  }
  return value.toLowerCase()
}

function normalizeAlias(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== "string") {
    throw new AppError(
      422,
      "validation_error",
      "El alias debe ser texto."
    )
  }
  const value = raw.trim().slice(0, CLIENT_META_ALIAS_MAX)
  return value.length > 0 ? value : null
}

/**
 * WhatsApp en formato libre: guarda los dígitos con código de país (y un `+`
 * inicial opcional). Acepta espacios, guiones y paréntesis; rechaza lo que
 * no parezca un teléfono (letras o menos de 8 dígitos). Vacío = borra el
 * dato.
 */
export function normalizeWhatsappPhone(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== "string") {
    throw new AppError(
      422,
      "validation_error",
      "El WhatsApp debe ser texto."
    )
  }
  const trimmed = raw.trim().slice(0, CLIENT_META_WHATSAPP_MAX + 8)
  if (trimmed.length === 0) return null
  const plus = trimmed.startsWith("+")
  const digits = trimmed.replace(/[^0-9]/g, "")
  if (digits.length < 8 || digits.length > 15) {
    throw new AppError(
      422,
      "validation_error",
      "El WhatsApp no parece un teléfono válido (8 a 15 dígitos con código de país)."
    )
  }
  return `${plus ? "+" : ""}${digits}`
}

function normalizePriceMxn(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  const value = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(
      422,
      "validation_error",
      "El precio debe ser un número mayor que 0."
    )
  }
  if (value > CLIENT_META_PRICE_MAX) {
    throw new AppError(
      422,
      "validation_error",
      `El precio no puede pasar de ${CLIENT_META_PRICE_MAX}.`
    )
  }
  return Math.round(value * 100) / 100
}

function parseRow(row: Record<string, unknown>): ClientMetadata {
  return {
    userName: typeof row.user_name === "string" ? row.user_name : "",
    alias: typeof row.alias === "string" && row.alias.length > 0 ? row.alias : null,
    whatsappPhone:
      typeof row.whatsapp_phone === "string" && row.whatsapp_phone.length > 0
        ? row.whatsapp_phone
        : null,
    priceMxn:
      typeof row.price_mxn === "number"
        ? row.price_mxn
        : row.price_mxn === null || row.price_mxn === undefined
          ? null
          : Number(row.price_mxn),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : null,
  }
}

/** Lee los metadatos de un cliente; null si nunca se editó. */
export async function getClientMetadata(
  userName: string
): Promise<ClientMetadata | null> {
  const key = userName.trim().toLowerCase()
  if (key.length === 0) return null
  const result = await pool.query(
    `SELECT user_name, alias, whatsapp_phone, price_mxn, updated_at
       FROM client_metadata
      WHERE user_name = $1`,
    [key]
  )
  const row = result.rows[0]
  return row ? parseRow(row) : null
}

/**
 * Mapa usuario (minúsculas) → metadatos para un listado de clientes: una
 * sola consulta acotada a los usuarios dados. Los usuarios sin fila no
 * aparecen en el mapa.
 */
export async function listClientMetadata(
  userNames: string[]
): Promise<Record<string, ClientMetadata>> {
  const keys = [
    ...new Set(
      userNames
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0)
    ),
  ]
  if (keys.length === 0) return {}
  const result = await pool.query(
    `SELECT user_name, alias, whatsapp_phone, price_mxn, updated_at
       FROM client_metadata
      WHERE user_name = ANY($1::text[])`,
    [keys]
  )
  const map: Record<string, ClientMetadata> = {}
  for (const row of result.rows) {
    const meta = parseRow(row)
    if (meta.userName) map[meta.userName] = meta
  }
  return map
}

export interface UpsertClientMetadataInput {
  userName: string
  userId: string
  alias?: unknown
  whatsappPhone?: unknown
  priceMxn?: unknown
}

/**
 * Guarda los metadatos de un cliente (upsert por usuario). Cada campo que
 * llega (`undefined` NO llegó) se fija; `null` borra el dato (`priceMxn:
 * null` = volver al precio general), y los campos ausentes se conservan tal
 * cual — el PUT del distribuidor no viaja con el precio, así que nunca pisa
 * el precio especial del admin. El usuario queda registrado en `updated_by`
 * para la trazabilidad del cambio.
 */
export async function upsertClientMetadata(
  input: UpsertClientMetadataInput
): Promise<ClientMetadata> {
  const userName = normalizeUserName(input.userName)
  const alias = normalizeAlias(input.alias)
  const whatsappPhone = normalizeWhatsappPhone(input.whatsappPhone)
  const priceMxn = normalizePriceMxn(input.priceMxn)
  const setAlias = input.alias !== undefined
  const setWhatsapp = input.whatsappPhone !== undefined
  const setPrice = input.priceMxn !== undefined

  const result = await pool.query(
    `INSERT INTO client_metadata (user_name, alias, whatsapp_phone, price_mxn, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5::uuid, now())
     ON CONFLICT (user_name) DO UPDATE SET
       alias = CASE WHEN $6::bool THEN EXCLUDED.alias ELSE client_metadata.alias END,
       whatsapp_phone = CASE WHEN $7::bool THEN EXCLUDED.whatsapp_phone ELSE client_metadata.whatsapp_phone END,
       price_mxn = CASE WHEN $8::bool THEN EXCLUDED.price_mxn ELSE client_metadata.price_mxn END,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING user_name, alias, whatsapp_phone, price_mxn, updated_at`,
    [
      userName,
      alias,
      whatsappPhone,
      priceMxn,
      input.userId,
      setAlias,
      setWhatsapp,
      setPrice,
    ]
  )
  return parseRow(result.rows[0])
}

/**
 * Precio vigente de la renovación de UN cliente: el precio especial si el
 * cliente lo tiene, o el precio general del servidor; null si no hay ninguno
 * configurado. Es la única fuente del importe de las órdenes (Mercado Pago,
 * transferencia y cupón) y de las cotizaciones del asistente, para que lo
 * cobrado siempre coincida con lo mostrado.
 */
export async function clientLicensePriceMxnOrNull(
  userName: string
): Promise<number | null> {
  const key = userName.trim().toLowerCase()
  if (key.length === 0) return licensePriceMxnOrNull()
  const result = await pool.query(
    "SELECT price_mxn FROM client_metadata WHERE user_name = $1",
    [key]
  )
  const raw = result.rows[0]?.price_mxn
  const override =
    typeof raw === "number"
      ? raw
      : raw === null || raw === undefined
        ? null
        : Number(raw)
  if (override !== null && Number.isFinite(override) && override > 0) {
    return Math.round(override * 100) / 100
  }
  return licensePriceMxnOrNull()
}
