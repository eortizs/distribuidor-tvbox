import { readFileSync } from "node:fs"

import { getStoredFlujoConfig } from "./settings"

/** Base por defecto de la API FlujoTV. */
export const DEFAULT_FLUJO_API_BASE = "https://api.eortizs.people-negocios.com"

/** De dónde sale la clave que se está usando. */
export type FlujoKeySource = "ajustes" | "env" | "file" | null

export interface FlujoResolvedConfig {
  baseUrl: string
  apiKey: string | null
  keySource: FlujoKeySource
  /** Identificador parcial de la clave: prefijo + últimos 4 caracteres. */
  maskedKey: string | null
  /** Última actualización de la clave guardada en el panel. */
  updatedAt: string | null
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

/**
 * La clave nunca sale del servidor. Solo se expone un identificador parcial
 * para distinguir una clave de otra en la interfaz.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 4) return "••••"
  const separator = key.indexOf("_")
  const prefix = separator > 0 ? key.slice(0, separator + 1) : ""
  return `${prefix}${"•".repeat(6)}${key.slice(-4)}`
}

function readKeyFromFile(path: string): string | null {
  try {
    const content = readFileSync(path, "utf8").trim()
    return content.length > 0 ? content : null
  } catch {
    return null
  }
}

/**
 * Clave del entorno: `FLUJO_API_KEY` o, en su defecto, el fichero que
 * apunte `FLUJO_API_KEY_FILE`.
 */
export function getEnvFlujoConfig(): {
  baseUrl: string
  apiKey: string | null
  keySource: "env" | "file" | null
  maskedKey: string | null
} {
  const baseUrl = normalizeBaseUrl(
    process.env.FLUJO_API_BASE?.trim() || DEFAULT_FLUJO_API_BASE
  )

  const fromEnv = process.env.FLUJO_API_KEY?.trim()
  if (fromEnv) {
    return {
      baseUrl,
      apiKey: fromEnv,
      keySource: "env",
      maskedKey: maskApiKey(fromEnv),
    }
  }

  const keyFile = process.env.FLUJO_API_KEY_FILE?.trim()
  if (keyFile) {
    const fromFile = readKeyFromFile(keyFile)
    if (fromFile) {
      return {
        baseUrl,
        apiKey: fromFile,
        keySource: "file",
        maskedKey: maskApiKey(fromFile),
      }
    }
  }

  return { baseUrl, apiKey: null, keySource: null, maskedKey: null }
}

const CACHE_TTL_MS = 10_000
let cache: { at: number; value: FlujoResolvedConfig } | null = null

/**
 * Configuración efectiva de la API de licencias.
 *
 * La clave guardada en el panel (Configuración → API de licencias) manda
 * sobre la del entorno: es la que el administrador activó desde la interfaz.
 * Sin clave guardada se usa `FLUJO_API_KEY` o `FLUJO_API_KEY_FILE`.
 */
export async function resolveFlujoConfig(): Promise<FlujoResolvedConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const env = getEnvFlujoConfig()
  let resolved: FlujoResolvedConfig = {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    keySource: env.keySource,
    maskedKey: env.maskedKey,
    updatedAt: null,
  }

  try {
    const stored = await getStoredFlujoConfig()
    if (stored) {
      resolved = {
        baseUrl: stored.baseUrl,
        apiKey: stored.apiKey,
        keySource: "ajustes",
        maskedKey: maskApiKey(stored.apiKey),
        updatedAt: stored.updatedAt,
      }
    }
  } catch (error) {
    // Sin tabla o sin acceso a la base de datos: se sigue con el entorno.
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `flujotv: no se pudieron leer los ajustes guardados: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }

  cache = { at: Date.now(), value: resolved }
  return resolved
}

/** Invalida la caché tras guardar o quitar la clave desde la interfaz. */
export function invalidateFlujoConfigCache(): void {
  cache = null
}
