import { pool } from "@/server/db"
import {
  cifrarToken,
  descifrarToken,
  isTokensCryptoReady,
} from "@/server/conectores/crypto"
import {
  isGoogleConectorEnabled,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "@/server/conectores/google-oauth"
import {
  findConector,
  isConectorConectable,
  type ConexionPublica,
} from "@/lib/conectores"
import { AppError } from "@/server/umejson/types"

/*
 * Repositorio de conexiones de conectores. Toda lectura y mutación llega
 * con el id del usuario de sesión y el SQL filtra por él. Los tokens se
 * guardan cifrados (AES-256-GCM) y jamás salen de este módulo: los
 * consumidores usan `accesoValido`, que devuelve un access_token fresco.
 */

const REFRESH_MARGIN_MS = 60_000

interface ConexionRow extends Record<string, unknown> {
  connector_id: string
  provider: string
  status: string
  account_email: string | null
  connected_at: Date
  access_token: string | null
  refresh_token: string | null
  expires_at: Date | null
  scope: string | null
  error_code: string | null
}

function publicar(row: ConexionRow): ConexionPublica {
  return {
    connectorId: row.connector_id,
    providerId: row.provider,
    status: row.status === "error" ? "error" : "connected",
    accountEmail: row.account_email,
    connectedAt: row.connected_at.toISOString(),
  }
}

/** Conexiones del usuario en forma pública: sin tokens. */
export async function listarConexiones(userId: string): Promise<ConexionPublica[]> {
  const { rows } = await pool.query(
    `SELECT connector_id, provider, status, account_email, connected_at
     FROM connector_connections WHERE user_id = $1 ORDER BY connected_at ASC`,
    [userId]
  )
  return rows.map((row) => publicar(row as ConexionRow))
}

async function obtenerRow(userId: string, connectorId: string): Promise<ConexionRow | null> {
  const { rows } = await pool.query(
    `SELECT connector_id, provider, status, account_email, connected_at,
            access_token, refresh_token, expires_at, scope, error_code
     FROM connector_connections WHERE user_id = $1 AND connector_id = $2`,
    [userId, connectorId]
  )
  return (rows[0] as ConexionRow | undefined) ?? null
}

/** Guarda (o reemplaza) la conexión de un conector para el usuario. */
export async function guardarConexion(
  userId: string,
  connectorId: string,
  tokens: {
    accessToken: string
    refreshToken: string | null
    expiresInMs: number
    scope: string
    accountEmail: string | null
  }
): Promise<void> {
  const previa = await obtenerRow(userId, connectorId)
  const refreshAnterior = descifrarToken(previa?.refresh_token ?? null)

  // Google solo repite el refresh_token cuando lo vuelve a conceder: si el
  // canje nuevo no lo trajo, se conserva el anterior (sigue vigente).
  const refreshToken = tokens.refreshToken ?? refreshAnterior
  if (refreshToken && refreshAnterior && refreshToken !== refreshAnterior) {
    // El refresh_token viejo queda huérfano: revocación best effort sin
    // bloquear la respuesta (el token caduca solo si Google no responde).
    void revokeGoogleToken(refreshAnterior)
  }

  await pool.query(
    `INSERT INTO connector_connections
       (user_id, connector_id, provider, status, account_email,
        access_token, refresh_token, expires_at, scope, connected_at, updated_at)
     VALUES ($1, $2, $3, 'connected', $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (user_id, connector_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       status = 'connected',
       account_email = EXCLUDED.account_email,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, connector_connections.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       error_code = NULL,
       connected_at = now(),
       updated_at = now()`,
    [
      userId,
      connectorId,
      findConector(connectorId)?.providerId ?? "",
      tokens.accountEmail,
      cifrarToken(tokens.accessToken),
      refreshToken ? cifrarToken(refreshToken) : null,
      new Date(Date.now() + tokens.expiresInMs),
      tokens.scope,
    ]
  )
}

/**
 * Access_token vigente para consumir la API del conector: renueva en frío
 * con el refresh_token cuando falta menos de un minuto. `null` si no hay
 * conexión utilizable (desconectada o marcada en error: hay que
 * reconectar desde la pantalla).
 *
 * Punto de entrada reservado para los consumidores del conector (p. ej.
 * eventos de Google Calendar): ninguno existe todavía, la conexión y su
 * ciclo de tokens quedan listos para el primer módulo que los use.
 */
export async function accesoValido(
  userId: string,
  connectorId: string
): Promise<string | null> {
  if (!isConectorConectable(connectorId)) return null
  const row = await obtenerRow(userId, connectorId)
  if (!row || row.status !== "connected") return null

  const accessToken = descifrarToken(row.access_token)
  const vigente =
    accessToken && row.expires_at && row.expires_at.getTime() - REFRESH_MARGIN_MS > Date.now()
  if (accessToken && vigente) return accessToken

  const refreshToken = descifrarToken(row.refresh_token)
  if (!refreshToken) {
    await marcarError(userId, connectorId, "sin_refresh_token")
    return null
  }

  try {
    const renovado = await refreshGoogleAccessToken(refreshToken)
    await pool.query(
      `UPDATE connector_connections
       SET access_token = $1, expires_at = $2, scope = COALESCE($3, scope),
           status = 'connected', error_code = NULL, updated_at = now()
       WHERE user_id = $4 AND connector_id = $5`,
      [
        cifrarToken(renovado.accessToken),
        new Date(Date.now() + renovado.expiresInMs),
        renovado.scope || null,
        userId,
        connectorId,
      ]
    )
    return renovado.accessToken
  } catch (error) {
    // invalid_grant deja el refresh_token muerto (usuario revocó o Google
    // lo caducó): la conexión pasa a error y pide reconexión. Los fallos
    // transitorios (red, 5xx) NO la marcan en error: el refresh_token
    // sigue válido y el siguiente consumo reintenta el refresh.
    if (error instanceof AppError && error.code === "google_grant_invalid") {
      await marcarError(userId, connectorId, "google_grant_invalid")
    } else {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: "conectores: refresh transitorio falló",
          detail: error instanceof Error ? error.message : String(error),
          connectorId,
        })
      )
    }
    return null
  }
}

export async function marcarError(
  userId: string,
  connectorId: string,
  errorCode: string
): Promise<void> {
  await pool.query(
    `UPDATE connector_connections
     SET status = 'error', error_code = $1, updated_at = now()
     WHERE user_id = $2 AND connector_id = $3`,
    [errorCode, userId, connectorId]
  )
}

/**
 * Elimina la conexión y revoca el refresh_token en el proveedor (best
 * effort): después de esto el acceso de la app a la cuenta queda anulado.
 */
export async function eliminarConexion(
  userId: string,
  connectorId: string
): Promise<boolean> {
  const row = await obtenerRow(userId, connectorId)
  if (!row) return false
  const refreshToken = descifrarToken(row.refresh_token)
  const accessToken = descifrarToken(row.access_token)
  const token = refreshToken ?? accessToken
  const { rowCount } = await pool.query(
    "DELETE FROM connector_connections WHERE user_id = $1 AND connector_id = $2",
    [userId, connectorId]
  )
  // Revocación best effort tras la baja local, sin bloquear la respuesta:
  // si Google no responde, el token caduca solo.
  if (token) void revokeGoogleToken(token)
  return (rowCount ?? 0) > 0
}

/** El flujo OAuth de Google está operativo (credenciales y cifrado listos). */
export function isConectoresGoogleListo(): boolean {
  return isGoogleConectorEnabled() && isTokensCryptoReady()
}