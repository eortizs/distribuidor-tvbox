"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { performBusinessSignup, signupCallerIp } from "@/server/onboarding/signup"
import { shortHost } from "@/server/tenant/hosts"

/**
 * Acción del formulario de registro público del apex (Fase 1, §4.1 del
 * plan). La validación y el alta viven en performBusinessSignup (compartida
 * con el fallback POST /api/onboarding/signup); aquí solo se traduce al
 * contrato de useActionState y se hace el redirect de entrega de sesión —
 * FUERA del try/catch (Next exige llamarlo así en acciones y route handlers).
 */

export interface SignupBusinessState {
  /** La acción no llegó por la reescritura del apex: el cliente reintenta
   * con fetch directo a POST /api/onboarding/signup. */
  fallback?: boolean
  error: string | null
}

export async function signupBusinessAction(
  _prev: SignupBusinessState,
  formData: FormData
): Promise<SignupBusinessState> {
  const h = await headers()
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase() ??
    h.get("host")?.split(":")[0]?.trim().toLowerCase() ??
    ""
  if (host !== shortHost()) {
    // La petición NO pasó por la reescritura del apex (proxy viejo, preview,
    // host del panel): el formulario reintenta por la ruta API, que el
    // matcher del proxy excluye y llega siempre directa.
    return { fallback: true, error: null }
  }

  const ip = await signupCallerIp()
  const result = await performBusinessSignup(
    {
      businessName: String(formData.get("businessName") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      legal: formData.get("legal") === "on" || formData.get("legal") === "true",
      website: String(formData.get("website") ?? ""),
    },
    ip
  )
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectUrl)
}
