import { listActiveTenants } from "./context"
import { tenantAllows, type TenantModule } from "@/lib/tenant-modules"
import { runAsPlatform, runWithTenant } from "./context"

/**
 * Iteración de schedulers por tenant (§4.6): cada scheduler recorre los
 * tenants activos que habilitan su módulo y corre su cuerpo bajo
 * runWithTenant — todo el trabajo en background queda aislado por RLS.
 * Un fallo del cuerpo de UN tenant no corta a los demás (se registra y
 * sigue): un tenant caído jamás suspende el trabajo de los otros.
 */
export async function runTickPerTenant(
  module: TenantModule,
  body: (tenantId: string) => Promise<void>,
  logContext: string
): Promise<void> {
  const tenants = await listActiveTenants()
  for (const tenant of tenants) {
    if (!tenantAllows(tenant.modules, module)) continue
    try {
      await runWithTenant(tenant.id, () => body(tenant.id))
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `${logContext}: tenant ${tenant.slug}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          tenant_id: tenant.id,
        })
      )
    }
  }
}

export { runAsPlatform, runWithTenant }
