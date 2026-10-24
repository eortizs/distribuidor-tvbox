import { pool } from "@/server/db"

import { decryptSecret, encryptSecret } from "./crypto"

/** Configuración de la API de licencias guardada en el panel. */
export interface StoredFlujoConfig {
  apiKey: string
  baseUrl: string
  updatedAt: string
}

/**
 * Ajustes guardados de la API de licencias. `null` si nunca se configuró
 * (el servidor usa entonces la clave del entorno) o si la clave guardada ya
 * no se puede descifrar (secrets rotados): en ese caso se pide de nuevo.
 */
export async function getStoredFlujoConfig(): Promise<StoredFlujoConfig | null> {
  const result = await pool.query(
    `SELECT api_key_encrypted, base_url, updated_at
       FROM flujotv_settings
      WHERE id = 1`
  )
  const row = result.rows[0]
  if (!row) return null

  const apiKey = decryptSecret(String(row.api_key_encrypted))
  if (!apiKey) return null

  return {
    apiKey,
    baseUrl: String(row.base_url),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  }
}

/** Guarda (o reemplaza) la clave y la URL base configuradas en el panel. */
export async function saveStoredFlujoConfig(input: {
  apiKey: string
  baseUrl: string
  userId: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO flujotv_settings (id, api_key_encrypted, base_url, updated_at, updated_by)
     VALUES (1, $1, $2, now(), $3)
     ON CONFLICT (id) DO UPDATE
        SET api_key_encrypted = EXCLUDED.api_key_encrypted,
            base_url = EXCLUDED.base_url,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by`,
    [encryptSecret(input.apiKey), input.baseUrl, input.userId]
  )
}

/** Quita la clave guardada: el servidor vuelve a la del entorno. */
export async function clearStoredFlujoConfig(): Promise<void> {
  await pool.query("DELETE FROM flujotv_settings WHERE id = 1")
}
