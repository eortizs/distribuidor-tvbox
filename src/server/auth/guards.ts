import { redirect } from "next/navigation"

import type { TenantModule } from "@/lib/tenant-modules"
import { tenantAllows } from "@/lib/tenant-modules"
import { currentTenantContext } from "@/server/tenant/context"
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
  return { ...user, tenantId: currentTenantContext()?.tenantId ?? null }
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
