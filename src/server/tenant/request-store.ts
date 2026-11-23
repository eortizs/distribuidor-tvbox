/**
 * Acceso a headers()/cookies() de Next para la resolución de contexto de
 * tenancy. MÓDULO HOJA con imports DINÁMICOS: `eve build` evalúa los módulos
 * authored con el loader ESM de Node FUERA del bundle de Next, donde un
 * import estático de `next/headers` rompe la evaluación (no hay extensiones
 * inferidas ni runtime de Next). En runtime de Next el import dinámico
 * responde normal; fuera de request scope, headers() lanza y se captura.
 */
import type { ReadableHeaders } from "./request-store-types"

export type { ReadableHeaders }

export async function readRequestHeaders(): Promise<ReadableHeaders | null> {
  try {
    const { headers } = await import("next/headers")
    return await headers()
  } catch {
    return null
  }
}

export async function readRequestCookies(): Promise<{
  get(name: string): { value: string } | undefined
} | null> {
  try {
    const { cookies } = await import("next/headers")
    return await cookies()
  } catch {
    return null
  }
}
