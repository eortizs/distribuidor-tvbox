import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"
import { cifrarToken, descifrarToken, isTokensCryptoReady } from "@/server/conectores/crypto"

import { mercadoPagoRequestAs } from "./client"
import { MercadoPagoError } from "./errors"

/*
 * Credencial de Mercado Pago PROPIA por usuario (Perfil → Datos bancarios).
 *
 * El token se guarda CIFRADO en reposo (AES-256-GCM con la clave de los
 * conectores) y es WRITE-ONLY: nunca vuelve al navegador ni se registra en
 * logs; el formulario muestra solo el estado (cuenta MP destino, últimos 4
 * caracteres, vigencia). Con su propio token, un distribuidor habilita la
 * verificación automática de depósitos hacia SU cuenta (links de pago,
 * renovaciones por transferencia) y el reporte SPEI de su propia cuenta.
 *
 * El admin conserva el token de plataforma del `.env`
 * (MERCADOPAGO_ACCESS_TOKEN): su cuenta es la receptora de las órdenes del
 * flujo histórico y no necesita credencial propia.
 *
 * La validación al guardar llama `GET /users/me` con el token propuesto: un
 * token inválido o de otra implementación (p. ej. token de prueba sin
 * acceso) se rechaza ANTES de cifrarse y el usuario ve el error en el
 * formulario. `mp_user_id`/`mp_nickname` quedan como evidencia de a qué
 * cuenta apunta la credencial.
 */

/** Metadatos para la UI (jamás incluye el token). */
export interface UserMpTokenStatus {
  /** Cuenta MP de destino (nickname de /users/me). */
  nickname: string | null
  /** ID numérico de la cuenta MP. */
  mpUserId: number | null
  /** Últimos 4 caracteres del token, para identificarla en la UI. */
  last4: string
  /** 'invalid' = MP la rechazó en algún uso; hay que re-registrarla. */
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

function mapStatus(row: TokenRow): UserMpTokenStatus {
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

/** Estado del token propio del usuario; null = sin token registrado. */
export async function getUserMpTokenStatus(
  userId: string
): Promise<UserMpTokenStatus | null> {
  const result = await pool.query<TokenRow>(
    `SELECT token_encrypted, token_last4, mp_user_id, mp_nickname, status,
            validated_at, updated_at
       FROM user_mp_tokens
      WHERE user_id = $1::uuid
      LIMIT 1`,
    [userId]
  )
  return result.rows[0] ? mapStatus(result.rows[0]) : null
}

/** Descifra el token propio; null sin credencial o si el secret cambió. */
async function decryptOwnToken(userId: string): Promise<string | null> {
  const result = await pool.query<{ token_encrypted: string }>(
    `SELECT token_encrypted FROM user_mp_tokens WHERE user_id = $1::uuid LIMIT 1`,
    [userId]
  )
  const stored = result.rows[0]?.token_encrypted
  return stored ? descifrarToken(stored) : null
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
        "Mercado Pago rechazó el token (401/403). Copia nuevamente el access token de producción de tu cuenta."
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

/**
 * Registra (o reemplaza) el token propio: valida contra MP primero, cifra y
 * hace upsert. Lanza AppError con mensajes listos para la UI.
 */
export async function saveUserMpToken(
  userId: string,
  rawToken: string
): Promise<UserMpTokenStatus> {
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
    `INSERT INTO user_mp_tokens
       (user_id, token_encrypted, token_last4, mp_user_id, mp_nickname,
        status, validated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, 'active', now())
     ON CONFLICT (user_id) DO UPDATE SET
       token_encrypted = EXCLUDED.token_encrypted,
       token_last4 = EXCLUDED.token_last4,
       mp_user_id = EXCLUDED.mp_user_id,
       mp_nickname = EXCLUDED.mp_nickname,
       status = 'active',
       validated_at = now(),
       updated_at = now()
     RETURNING token_encrypted, token_last4, mp_user_id, mp_nickname,
               status, validated_at, updated_at`,
    [
      userId,
      encrypted,
      last4,
      cuenta.mpUserId,
      cuenta.nickname,
    ]
  )
  return mapStatus(result.rows[0])
}

/** Quita el token propio (idempotente). */
export async function clearUserMpToken(userId: string): Promise<void> {
  await pool.query(`DELETE FROM user_mp_tokens WHERE user_id = $1::uuid`, [
    userId,
  ])
}

/**
 * Descifra el token propio vigente; null si no hay, el secret cambió o el
 * token quedó marcado inválido (la UI pide re-registrarlo).
 */
export async function getOwnMpAccessToken(userId: string): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM user_mp_tokens WHERE user_id = $1::uuid LIMIT 1`,
    [userId]
  )
  if (result.rows[0]?.status !== "active") return null
  return decryptOwnToken(userId)
}

/**
 * Token de lectura para la cuenta que RECIBE el dinero de una operación:
 * `sellerUserId` = usuario con credencial propia (distribuidor); `null` =
 * cuenta de plataforma del `.env` (flujo histórico del admin). Null = no hay
 * forma de consultar esa cuenta: el llamador conserva el comportamiento sin
 * verificación (jamás bloquea por falta de credencial).
 */
export async function resolveSellerMpAccessToken(
  sellerUserId: string | null
): Promise<string | null> {
  if (sellerUserId !== null) return getOwnMpAccessToken(sellerUserId)
  const platform = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? ""
  return platform.length > 0 ? platform : null
}

/**
 * Token de verificación de depósitos para las órdenes de pago de UN creador
 * (módulo SPEILink): su credencial propia si tiene; si no, la de
 * plataforma SOLO para admins (los cobros del admin apuntan a la cuenta del
 * `.env`). Un distribuidor sin token propio → null: verificación manual.
 */
export async function resolvePaymentOrderDepositToken(
  creatorUserId: string
): Promise<string | null> {
  const own = await getOwnMpAccessToken(creatorUserId)
  if (own) return own
  const role = await pool.query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1::uuid LIMIT 1`,
    [creatorUserId]
  )
  if (role.rows[0]?.role !== "admin") return null
  const platform = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? ""
  return platform.length > 0 ? platform : null
}

/**
 * Marca el token propio como inválido tras un rechazo de MP en uso (401):
 * deja de usarse para verificar y el perfil muestra que hay que
 * re-registrarlo. Mejor esfuerzo, nunca lanza.
 */
export async function markUserMpTokenInvalid(userId: string): Promise<void> {
  await pool
    .query(
      `UPDATE user_mp_tokens SET status = 'invalid', updated_at = now()
        WHERE user_id = $1::uuid AND status = 'active'`,
      [userId]
    )
    .catch(() => {})
}
