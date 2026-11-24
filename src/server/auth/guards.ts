import { notFound, redirect } from "next/navigation"

import type { TenantModule } from "@/lib/tenant-modules"
import { tenantAllows } from "@/lib/tenant-modules"
import { effectiveTenantModules } from "@/server/tenant/modules"
import { getSessionUser } from "./session"
import type { AuthUser, UserRole } from "./types"

/**
 * Guards de página (§4.5): el módulo es OBLIGATORIO para que TypeScript
 * obligue a clasificar cada página. Si el tenant del usuario no habilita el
 * módulo, redirige al inicio (la página queda bloqueada aunque la ruta siga
 * servida).
 */
export async function requireUser(module: TenantModule): Promise<AuthUser> {
  const user = await getSessionUser()
  if (!user) {
    redirect("/login")
  }
  const modules = await effectiveTenantModules()
  if (!tenantAllows(modules, module)) {
    redirect("/clientes")
  }
  // El tenant viene EN la sesión (getSessionUser): el contexto ALS no cruza
  // de forma fiable los awaits de Next (ver comentario allí).
  return { ...user, tenantId: user.tenantId ?? null }
}

/**
 * Consola de plataforma (§4.5): requiere sesión en el host de plataforma Y
 * rol `plataforma`. En otro host la página responde 404 neutro.
 */
export async function requirePlatformUser(): Promise<AuthUser> {
  const { resolveTenantHost } = await import("@/server/tenant/hosts")
  const { requestHost } = await import("@/server/tenant/request-host")
  const { isPlatformRole } = await import("./types")
  if (resolveTenantHost(await requestHost()).kind !== "platform") {
    notFound()
  }
  const user = await requireUser("core")
  if (!isPlatformRole(user.role)) {
    notFound()
  }
  return user
}

export async function requireRole(
  role: UserRole,
  module: TenantModule
): Promise<AuthUser> {
  const user = await requireUser(module)
  if (user.role !== role) {
    redirect("/clientes")
  }
  return user
}
