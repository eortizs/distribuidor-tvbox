import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"
import { cifrarToken, descifrarToken, isTokensCryptoReady } from "@/server/conectores/crypto"
import { runWithPlatformTenant } from "@/server/tenant/context"

import { mercadoPagoRequestAs } from "@/server/mercadopago/client"
import { MercadoPagoError } from "@/server/mercadopago/errors"

/**
 * Cuenta del NEGOCIO a nivel tenant (Fase 3, §3 del plan): datos bancarios
 * (tenants.bank_*) y token de Mercado Pago del negocio (tenant_mp_tokens,
 * espejo de user_mp_tokens con el mismo cifrado). El propietario captura
 * ambos desde su panel; las sucursales heredan salvo override propio propio
 * (la resolución por niveles vive en links-pago/bank.ts y mercadopago/
 * tokens.ts: perfil propio completo → negocio → plataforma).
 */

export interface TenantBanking {
  bankName: string | null
  bankHolder: string | null
  bankClabe: string | null
}

/** Datos bancarios del negocio; null si el tenant no existe. */
export async function getTenantBanking(
  tenantId: string
): Promise<TenantBanking | null> {
  const result = await pool.query<{
    bank_name: string | null
    bank_holder: string | null
    bank_clabe: string | null
  }>(
    `SELECT bank_name, bank_holder, bank_clabe
       FROM tenants WHERE id = $1::uuid LIMIT 1`,
    [tenantId]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    bankName: row.bank_name,
    bankHolder: row.bank_holder,
    bankClabe: row.bank_clabe,
  }
}

const CLABE_RE = /^[0-9]{18}$/

/**
 * Tenant de negocio de una cuenta (fuente única para las acciones de
 * propietario): null si la cuenta no pertenece a un tenant de negocio
 * (plataforma, legado TVBox). El tipo de tenant lo resuelve systemPool
 * (cache 30 s), no el contexto de la petición.
 */
export async function businessTenantIdOfUser(userId: string): Promise<string | null> {
  const result = await pool.query<{ tenant_id: string | null }>(
    `SELECT tenant_id FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  )
  const tenantId = result.rows[0]?.tenant_id ?? null
  if (!tenantId) return null
  const { findTenantById } = await import("@/server/tenant/context")
  const tenant = await findTenantById(tenantId)
  return tenant?.kind === "business" ? tenantId : null
}

/**
 * Guarda los datos bancarios del negocio (propietario). Vaciar un campo lo
 * limpia: la cuenta del negocio puede quedar «sin datos» a propósito.
 *
 * El UPDATE corre bajo `runWithPlatformTenant`: `tenants_write` SOLO deja
 * escribir a plataforma (RLS, db/tenants-schema.sql) y bajo el contexto del
 * tenant la fila no es actualizable (0 filas → 404). Columnas fijas y
 * `kind = 'business'`: el tenant legado jamás se toca desde aquí.
 */
export async function saveTenantBanking(
  tenantId: string,
  input: { bankName: string; bankHolder: string; bankClabe: string }
): Promise<TenantBanking> {
  const bankName = input.bankName.trim()
  const bankHolder = input.bankHolder.trim()
  const bankClabe = input.bankClabe.replace(/\s+/g, "")
  if (bankName.length > 60) {
    throw new AppError(422, "banco_invalido", "El banco no puede exceder 60 caracteres.")
  }
  if (bankHolder.length > 100) {
    throw new AppError(422, "destinatario_invalido", "El destinatario no puede exceder 100 caracteres.")
  }
  if (bankClabe.length > 0 && !CLABE_RE.test(bankClabe)) {
    throw new AppError(422, "clabe_invalida", "La CLABE debe tener exactamente 18 dígitos.")
  }
  const result = await runWithPlatformTenant(tenantId, () =>
    pool.query<{
      bank_name: string | null
      bank_holder: string | null
      bank_clabe: string | null
    }>(
      `UPDATE tenants
          SET bank_name = NULLIF($2, ''),
              bank_holder = NULLIF($3, ''),
              bank_clabe = NULLIF($4, ''),
              updated_at = now()
        WHERE id = $1::uuid AND kind = 'business'
        RETURNING bank_name, bank_holder, bank_clabe`,
      [tenantId, bankName, bankHolder, bankClabe]
    )
  )
  const row = result.rows[0]
  if (!row) {
    throw new AppError(404, "tenant_no_encontrado", "El tenant no existe.")
  }
  return { bankName: row.bank_name, bankHolder: row.bank_holder, bankClabe: row.bank_clabe }
}

/** Metadatos del token del negocio para la UI (jamás incluye el token). */
export interface TenantMpTokenStatus {
  nickname: string | null
  mpUserId: number | null
  last4: string
  status: "active" | "invalid"
  validatedAt: string | null
  updatedAt: string
}

interface TokenRow {
  token_encrypted: string
  token_last4: string
  mp_user_id: string | number | null
  mp_nickname: string | null
  status: string
  validated_at: Date | null
  updated_at: Date
}

function mapStatus(row: TokenRow): TenantMpTokenStatus {
  return {
    nickname: row.mp_nickname,
    mpUserId:
      row.mp_user_id === null || row.mp_user_id === undefined
        ? null
        : Number(row.mp_user_id),
    last4: String(row.token_last4),
    status: row.status === "invalid" ? "invalid" : "active",
    validatedAt: row.validated_at
      ? new Date(row.validated_at).toISOString()
      : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** Estado del token del negocio; null = sin token registrado. */
export async function getTenantMpTokenStatus(
  tenantId: string
): Promise<TenantMpTokenStatus | null> {
  const result = await pool.query<TokenRow>(
    `SELECT token_encrypted, token_last4, mp_user_id, mp_nickname, status,
            validated_at, updated_at
       FROM tenant_mp_tokens
      WHERE tenant_id = $1::uuid
      LIMIT 1`,
    [tenantId]
  )
  return result.rows[0] ? mapStatus(result.rows[0]) : null
}

interface MpUsersMe {
  id?: unknown
  nickname?: unknown
}

/** Valida el token contra MP y devuelve la cuenta destino. */
async function validarConMercadoPago(rawToken: string): Promise<{
  mpUserId: number | null
  nickname: string | null
}> {
  let data: MpUsersMe
  try {
    const response = await mercadoPagoRequestAs<MpUsersMe>(
      rawToken,
      "/users/me",
      { timeoutMs: 10_000 }
    )
    data = response.data
  } catch (error) {
    if (
      error instanceof MercadoPagoError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw new AppError(
        422,
        "token_invalido",
        "Mercado Pago rechazó el token (401/403). Copia nuevamente el access token de producción de la cuenta del negocio."
      )
    }
    throw new AppError(
      502,
      "token_validacion_fallo",
      "No se pudo validar el token con Mercado Pago en este momento. Inténtalo de nuevo en unos minutos."
    )
  }
  const id = Number(data?.id)
  const nickname =
    typeof data?.nickname === "string" && data.nickname.trim().length > 0
      ? data.nickname.trim()
      : null
  return {
    mpUserId: Number.isFinite(id) && id > 0 ? id : null,
    nickname,
  }
}

/** Registra (o reemplaza) el token del negocio: valida, cifra y upsert. */
export async function saveTenantMpToken(
  tenantId: string,
  rawToken: string
): Promise<TenantMpTokenStatus> {
  const token = rawToken.trim()
  if (!isTokensCryptoReady()) {
    throw new AppError(
      503,
      "tokens_crypto_missing",
      "El servidor no tiene secret de cifrado para guardar tokens de Mercado Pago."
    )
  }
  if (token.length < 20 || token.length > 512) {
    throw new AppError(
      422,
      "token_formato",
      "El access token de Mercado Pago no tiene una forma válida."
    )
  }

  const cuenta = await validarConMercadoPago(token)
  const encrypted = cifrarToken(token)
  const last4 = token.slice(-4)

  const result = await pool.query<TokenRow>(
    `INSERT INTO tenant_mp_tokens
       (tenant_id, token_encrypted, token_last4, mp_user_id, mp_nickname,
        status, validated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, 'active', now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       token_encrypted = EXCLUDED.token_encrypted,
       token_last4 = EXCLUDED.token_last4,
       mp_user_id = EXCLUDED.mp_user_id,
       mp_nickname = EXCLUDED.mp_nickname,
       status = 'active',
       validated_at = now(),
       updated_at = now()
     RETURNING token_encrypted, token_last4, mp_user_id, mp_nickname,
               status, validated_at, updated_at`,
    [tenantId, encrypted, last4, cuenta.mpUserId, cuenta.nickname]
  )
  return mapStatus(result.rows[0])
}

/** Quita el token del negocio (idempotente). */
export async function clearTenantMpToken(tenantId: string): Promise<void> {
  await pool.query(`DELETE FROM tenant_mp_tokens WHERE tenant_id = $1::uuid`, [
    tenantId,
  ])
}

/**
 * Declara el WhatsApp del negocio (§4.5 del plan): dígitos canónicos con
 * código de país. El índice único parcial `tenants_whatsapp_number_uidx`
 * garantiza UNA sesión por número: un número tomado por otro negocio
 * responde 409. La escritura corre bajo `runWithPlatformTenant` (la política
 * `tenants_write` solo deja escribir a plataforma) con columnas fijas y
 * `kind = 'business'`.
 */
export async function saveTenantWhatsappNumber(
  tenantId: string,
  rawNumber: string
): Promise<string> {
  const { normalizeWhatsAppDigits, canonicalWhatsAppDigits, isValidWhatsAppNumber } =
    await import("@/server/whatsapp/config")
  const canonical = canonicalWhatsAppDigits(normalizeWhatsAppDigits(rawNumber))
  if (!isValidWhatsAppNumber(canonical)) {
    throw new AppError(
      422,
      "whatsapp_invalido",
      "Escribe el número con código de país (52 para México) sin espacios ni guiones."
    )
  }
  try {
    const result = await runWithPlatformTenant(tenantId, () =>
      pool.query<{ id: string }>(
        `UPDATE tenants
            SET whatsapp_number = $2,
                updated_at = now()
          WHERE id = $1::uuid AND kind = 'business'
          RETURNING id`,
        [tenantId, canonical]
      )
    )
    if (!result.rows[0]) {
      throw new AppError(404, "tenant_no_encontrado", "El tenant no existe.")
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    if ((error as { code?: string }).code !== "23505") throw error
    throw new AppError(
      409,
      "whatsapp_ocupado",
      "Ese número ya está vinculado a otro negocio."
    )
  }
  return canonical
}

/**
 * Descifra el token del negocio vigente; null si no hay, el secret cambió o
 * quedó marcado inválido.
 */
export async function getTenantMpAccessToken(
  tenantId: string
): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM tenant_mp_tokens WHERE tenant_id = $1::uuid LIMIT 1`,
    [tenantId]
  )
  if (result.rows[0]?.status !== "active") return null
  const stored = await pool.query<{ token_encrypted: string }>(
    `SELECT token_encrypted FROM tenant_mp_tokens WHERE tenant_id = $1::uuid LIMIT 1`,
    [tenantId]
  )
  const token = stored.rows[0]?.token_encrypted
  return token ? descifrarToken(token) : null
}
