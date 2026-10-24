"use server"

import { requireUser } from "@/server/auth/guards"
import {
  DEFAULT_FLUJO_API_BASE,
  invalidateFlujoConfigCache,
  maskApiKey,
} from "@/server/flujotv/config"
import { isEncryptionAvailable } from "@/server/flujotv/crypto"
import { probeFlujoApiKey } from "@/server/flujotv/service"
import {
  clearStoredFlujoConfig,
  saveStoredFlujoConfig,
} from "@/server/flujotv/settings"

export interface LicenciasApiState {
  error: string | null
  success: string | null
  /** Aviso que no impide guardar (por ejemplo, una clave sin scopes). */
  warning: string | null
  /** La clave quedó guardada: solo entonces se limpia el formulario. */
  saved: boolean
  /** Qué intentaba hacer el formulario (mensaje del error). */
  intent: "test" | "save" | null
}

function readBaseUrl(formData: FormData): string {
  const raw = String(formData.get("baseUrl") ?? "").trim()
  return (raw || DEFAULT_FLUJO_API_BASE).replace(/\/+$/, "")
}

function readApiKey(formData: FormData): string {
  return String(formData.get("apiKey") ?? "").trim()
}

/** Solo un admin puede cambiar la clave que usa todo el panel. */
async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== "admin") {
    throw new Error("Solo un administrador puede cambiar la clave de la API.")
  }
  return user
}

/**
 * Acción del formulario de la API de licencias.
 *
 * `intent` decide qué hace: `test` solo comprueba la clave contra la API,
 * `save` la comprueba y la guarda (cifrada) para activar el módulo.
 */
export async function licenciasApiAction(
  _prev: LicenciasApiState,
  formData: FormData
): Promise<LicenciasApiState> {
  const user = await requireAdmin()
  const intent: "test" | "save" =
    String(formData.get("intent")) === "test" ? "test" : "save"

  const apiKey = readApiKey(formData)
  if (!apiKey) {
    return {
      error: "Escribe la clave de la API.",
      success: null,
      warning: null,
      saved: false,
      intent,
    }
  }

  const baseUrl = readBaseUrl(formData)
  const probe = await probeFlujoApiKey({ apiKey, baseUrl })

  if (intent === "test") {
    if (probe.ok) {
      return {
        error: null,
        success: probe.message,
        warning: null,
        saved: false,
        intent,
      }
    }
    return {
      error: probe.message,
      success: null,
      warning:
        probe.status === 403
          ? "La clave responde, pero la API la rechaza por falta de scope."
          : null,
      saved: false,
      intent,
    }
  }

  if (!probe.ok && probe.status !== 403) {
    return {
      error: probe.message,
      success: null,
      warning: null,
      saved: false,
      intent,
    }
  }

  if (!isEncryptionAvailable()) {
    return {
      error:
        "El servidor no tiene secreto de cifrado (FLUJO_ENCRYPTION_SECRET o DATABASE_URL). No se puede guardar la clave.",
      success: null,
      warning: null,
      saved: false,
      intent,
    }
  }

  await saveStoredFlujoConfig({ apiKey, baseUrl, userId: user.id })
  invalidateFlujoConfigCache()

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "flujotv.key.saved",
      actor: `user:${user.username}`,
      base_url: baseUrl,
      masked_key: maskApiKey(apiKey),
    })
  )

  return {
    error: null,
    success: "Clave guardada. El módulo de licencias ya está activo.",
    warning: probe.ok
      ? null
      : "La clave se guardó, pero la API responde 403: le falta algún scope.",
    saved: true,
    intent,
  }
}

/** Quita la clave guardada: el servidor vuelve a la del entorno. */
export async function clearFlujoApiKeyAction(): Promise<LicenciasApiState> {
  const user = await requireAdmin()

  await clearStoredFlujoConfig()
  invalidateFlujoConfigCache()

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "flujotv.key.cleared",
      actor: `user:${user.username}`,
    })
  )

  return {
    error: null,
    success: "Clave eliminada. El módulo vuelve a la clave del entorno.",
    warning: null,
    saved: false,
    intent: null,
  }
}
