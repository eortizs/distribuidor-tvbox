/**
 * Clasificación de módulos por tenant (§4.5 del plan): TIPO puro, sin BD ni
 * Next. `tenantAllows` es la guarda que consumen requireApiUser / requireUser
 * / requireRole: TypeScript obliga a clasificar cada ruta, acción y página.
 *
 * - legado (`tvbox`): los tres módulos, sin cambios visibles.
 * - negocio (`business`): SOLO `core` (SPEILink). `general` y `flujo` quedan
 *   ocultos y bloqueados.
 * - plataforma (sin tenant): decisión de la consola (fase 2); el catálogo
 *   completo está permitido a nivel de módulos.
 */

export type TenantModule = "core" | "general" | "flujo"

export const TENANT_MODULE_KINDS = ["legacy", "business"] as const
export type TenantKind = (typeof TENANT_MODULE_KINDS)[number]

/** Módulos del tenant legado: todo el panel actual. */
export const LEGACY_TENANT_MODULES: TenantModule[] = ["core", "general", "flujo"]

/** Módulos de un tenant de negocio en esta entrega: solo núcleo SPEILink. */
export const BUSINESS_TENANT_MODULES: TenantModule[] = ["core"]

/** Clasificación de referencia (§4.5) — prefijos de ruta por módulo. */
export const CORE_ROUTE_PREFIXES = [
  "/clientes",
  "/onboarding",
  "/modulos/links-de-pago",
  "/modulos/reporte-spei",
  "/modulos/calculadora",
  "/modulos/alta-de-articulos",
  "/modulos/nota-digital",
  "/perfil",
  "/profile",
  "/users",
  "/modulos/whatsapp",
  "/api/links-pago",
  "/api/mercadopago/spei",
  "/api/articulos",
  "/api/whatsapp",
  "/api/users",
  "/api/files",
  "/api/profile",
  "/api/realtime",
  "/api/auth",
  "/api/onboarding",
]

export const FLUJO_ROUTE_PREFIXES = [
  "/modulos/paquetes-flujotv",
  "/modulos/actualizacion-flujotv",
  "/modulos/distribuidores",
  "/modulos/saldo",
  "/modulos/licencias",
  "/modulos/flujotv-app",
  "/api/flujotv",
  "/api/mercadopago/orders",
  "/api/cupones",
  "/api/transferencias",
  "/api/paquetes",
  "/api/saldo",
  "/api/reembolsos",
  "/api/clientes/chips",
  "/api/clientes/filters",
  "/api/clientes/metadata",
]

export const GENERAL_ROUTE_PREFIXES = [
  "/modulos/alertas",
  "/modulos/imagenes",
  "/modulos/animacion",
  "/modulos/conectores",
  "/modulos/cronometro",
  "/modulos/lista-compras",
  "/modulos/tickets",
  "/modulos/notas",
  "/soporte/asistente",
  "/api/alertas",
  "/api/imagenes",
  "/api/animacion",
  "/api/conectores",
  "/api/cronometro",
  "/api/lista-compras",
  "/api/tickets",
  "/api/notas",
  "/api/asistente",
  "/api/entities",
  "/api/v1",
]

export function modulesForKind(kind: TenantKind): TenantModule[] {
  return kind === "legacy" ? LEGACY_TENANT_MODULES : BUSINESS_TENANT_MODULES
}

/** ¿El conjunto de módulos del tenant habilita el módulo pedido? */
export function tenantAllows(
  modules: string[] | null | undefined,
  module: TenantModule
): boolean {
  if (modules === null || modules === undefined) return true
  return modules.includes(module)
}

/** Clasifica una ruta de la app por su prefijo (referencia para el implementador). */
export function routeModuleForPath(pathname: string): TenantModule {
  const matches = (prefixes: string[]) =>
    prefixes.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p)
    )
  if (matches(CORE_ROUTE_PREFIXES)) return "core"
  if (matches(FLUJO_ROUTE_PREFIXES)) return "flujo"
  if (matches(GENERAL_ROUTE_PREFIXES)) return "general"
  return "general"
}
