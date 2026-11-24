import { isOwnerRole } from "@/server/auth/types"
import type { TenantModule } from "@/lib/tenant-modules"
import { tenantAllows } from "@/lib/tenant-modules"
import { effectiveTenantModules } from "@/server/tenant/modules"
import { getSessionUser } from "./session"
import type { AuthUser } from "./types"

export const MODULO_NO_DISPONIBLE = "modulo_no_disponible"

/**
 * Guard de API (§4.5): el módulo es OBLIGATORIO — TypeScript obliga a
 * clasificar las ~73 rutas. Devuelve null si no hay sesión o si el tenant
 * del usuario no habilita el módulo (la ruta responde 403 modulo_no_disponible).
 */
export async function requireApiUser(
  module: TenantModule
): Promise<AuthUser | null> {
  try {
    const user = await getSessionUser()
    if (!user) return null
    const modules = await effectiveTenantModules()
    if (!tenantAllows(modules, module)) return null
    // El tenant viene EN la sesión (getSessionUser): el contexto ALS no
    // cruza de forma fiable los awaits de Next (ver comentario allí).
    return { ...user, tenantId: user.tenantId ?? null }
  } catch {
    return null
  }
}

/** Como `requireApiUser`, pero null también para no-admins. */
export async function requireAdminApiUser(
  module: TenantModule
): Promise<AuthUser | null> {
  const user = await requireApiUser(module)
  return user && isOwnerRole(user.role) ? user : null
}

export function unauthorizedResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "unauthorized", message: "Authentication required" },
    },
    { status: 401 }
  )
}

export function forbiddenResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "forbidden", message: "Solo el administrador puede hacer esto." },
    },
    { status: 403 }
  )
}

/** 403 por módulo bloqueado para el tenant del usuario. */
export function moduleUnavailableResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: MODULO_NO_DISPONIBLE,
        message: "Este módulo no está disponible para tu cuenta.",
      },
    },
    { status: 403 }
  )
}

export function actorFor(user: AuthUser): string {
  return `user:${user.username}`
}
