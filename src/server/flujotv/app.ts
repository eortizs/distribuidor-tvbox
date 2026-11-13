import { pool } from "@/server/db"

import {
  FLUJO_APP_DEFAULT,
  type FlujoAppCampo,
  type FlujoAppInfo,
} from "@/lib/flujotv-app"

const URL_RE = /^https?:\/\/\S+$/

/**
 * Información vigente de la app: la fila guardada en `flujotv_app` o los
 * valores por defecto. Un fallo de lectura (tabla aún no migrada, DB
 * caída) no tumba la tarjeta: sirve los valores por defecto.
 */
export async function getFlujoApp(): Promise<FlujoAppInfo> {
  try {
    const result = await pool.query(
      `SELECT version, downloader_code, url_tv, url_celular
         FROM flujotv_app
        WHERE id = 1`
    )
    const row = result.rows[0]
    if (!row) return { ...FLUJO_APP_DEFAULT }
    return {
      version: String(row.version),
      downloaderCode: String(row.downloader_code),
      urlTv: String(row.url_tv),
      urlCelular: String(row.url_celular),
    }
  } catch {
    return { ...FLUJO_APP_DEFAULT }
  }
}

/**
 * Guarda un campo (upsert de la fila única) y devuelve el estado completo
 * resultante, listo para pintar. Valida el contenido según el campo; los
 * enlaces deben ser URLs absolutas http(s).
 */
export async function saveFlujoAppCampo(
  campo: FlujoAppCampo,
  valor: string,
  userId: string
): Promise<FlujoAppInfo> {
  const limpio = valor.trim()
  if (limpio.length === 0) {
    throw new Error("El valor no puede quedar vacío.")
  }
  if ((campo === "urlTv" || campo === "urlCelular") && !URL_RE.test(limpio)) {
    throw new Error("El enlace debe empezar por http:// o https://.")
  }

  const actual = await getFlujoApp()
  const nuevo: FlujoAppInfo = { ...actual, [campo]: limpio }

  await pool.query(
    `INSERT INTO flujotv_app (id, version, downloader_code, url_tv, url_celular, updated_at, updated_by)
     VALUES (1, $1, $2, $3, $4, now(), $5)
     ON CONFLICT (id) DO UPDATE
        SET version = EXCLUDED.version,
            downloader_code = EXCLUDED.downloader_code,
            url_tv = EXCLUDED.url_tv,
            url_celular = EXCLUDED.url_celular,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by`,
    [nuevo.version, nuevo.downloaderCode, nuevo.urlTv, nuevo.urlCelular, userId]
  )

  return nuevo
}
