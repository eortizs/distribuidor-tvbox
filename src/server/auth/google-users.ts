import { createAccount } from "./accounts"
import type { GoogleProfile } from "./google"
import type { AuthUser } from "./types"
import { findUserByGoogleSub, findUserByUsername } from "./users"
import { AppError } from "@/server/umejson/types"
import { tenantIdOfUser } from "@/server/tenant/context"

export type GoogleUserResolution =
  | { kind: "session"; user: AuthUser; storedPicture: string | null }
  /** Cuenta local del mismo correo: falta la prueba por contraseña. */
  | { kind: "link" }
  /** El correo de ESTE panel ya está ligado a otra identidad Google. */
  | { kind: "conflict" }
  /** El correo o la identidad Google ya pertenece a OTRO panel. */
  | { kind: "elsewhere" }
  /** Alta cerrada (`GOOGLE_TENANT_SIGNUP=invite`): no hay cuenta aquí. */
  | { kind: "not_registered" }

function toSessionUser(user: {
  id: string
  username: string
  role: AuthUser["role"]
  googlePicture: string | null
}): { user: AuthUser; storedPicture: string | null } {
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      googlePicture: user.googlePicture,
    },
    storedPicture: user.googlePicture,
  }
}

/**
 * La fila encontrada debe ser de ESTE panel. La búsqueda ya llega acotada por
 * el contexto (RLS), pero `username` y `google_sub` son únicos GLOBALES y la
 * comprobación explícita no depende de que el aislamiento esté efectivo.
 */
async function belongsToPanel(
  userId: string,
  tenantId: string | null
): Promise<boolean> {
  return tenantId === null || (await tenantIdOfUser(userId)) === tenantId
}

/**
 * Resuelve la cuenta para una identidad Google verificada: por google_sub,
 * luego por correo (vínculo pendiente de prueba por contraseña) o creándola
 * como sucursal del panel.
 *
 * Si la creación pierde una carrera (23505: otra petición creó la cuenta
 * primero) reintenta la resolución con la fila ya existente — UNA vez. Un
 * segundo 23505 significa que el correo o la identidad ya vive en OTRO panel
 * (invisible bajo RLS): ahí se corta en vez de reintentar sin fin.
 */
export async function resolveGoogleUser(
  profile: GoogleProfile,
  email: string,
  options: { tenantId: string | null; allowSignup: boolean }
): Promise<GoogleUserResolution> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 1) Cuenta ya ligada por google_sub.
    const bySub = await findUserByGoogleSub(profile.sub)
    if (bySub) {
      if (!(await belongsToPanel(bySub.id, options.tenantId))) {
        return { kind: "elsewhere" }
      }
      return { kind: "session", ...toSessionUser(bySub) }
    }

    // 2) Cuenta local con el mismo correo: el dueño debe probar posesión
    //    iniciando sesión con su contraseña; el vínculo automático por correo
    //    no verificado permitiría adelantarse a la cuenta real.
    const local = await findUserByUsername(email)
    if (local) {
      if (!(await belongsToPanel(local.id, options.tenantId))) {
        return { kind: "elsewhere" }
      }
      if (local.googleSub && local.googleSub !== profile.sub) {
        return { kind: "conflict" }
      }
      if (!local.googleSub) {
        return { kind: "link" }
      }
      return { kind: "session", ...toSessionUser(local) }
    }

    // 3) Cuenta nueva de Google (sucursal, sin contraseña local).
    if (!options.allowSignup) {
      return { kind: "not_registered" }
    }
    try {
      const created = await createAccount({
        email,
        googleSub: profile.sub,
        googlePicture: profile.picture,
        fullName: profile.name ?? undefined,
        tenantId: options.tenantId ?? undefined,
        source: "google-oauth",
      })
      return {
        kind: "session",
        user: created,
        storedPicture: profile.picture,
      }
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "email_taken") {
        throw error
      }
    }
  }
  return { kind: "elsewhere" }
}
