import { effectiveDbContext, findTenantById } from "./context"

/**
 * Módulos habilitados del contexto actual (tenants.modules). null = sin
 * tenant resuelto o plataforma ⇒ el catálogo completo está permitido (la
 * restricción de módulos es por tenant de negocio, no por usuario).
 */
export async function effectiveTenantModules(): Promise<string[] | null> {
  const context = await effectiveDbContext()
  if (!context) return null
  if (context.platform) return null
  if (!context.tenantId) return null
  const tenant = await findTenantById(context.tenantId)
  return tenant?.modules ?? null
}
