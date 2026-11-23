import { setRequestContext } from "@/server/tenant/context"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { hostTenantIdForRequest } from "@/server/tenant/identity"
import { requestHost, requestOrigin } from "@/server/tenant/request-host"

import {
  googleClientKit,
  legacyGoogleClient,
  publicOrigin,
  speilinkGoogleClient,
  type GoogleClientKit,
} from "./google"
import { selectGoogleFlow, type GoogleFlow } from "./google-relay"

/**
 * Flujo de Google que aplica a la petición HTTP actual, resuelto por HOST
 * (multitenant): los dos handlers de OAuth son rutas `/api` y NO pasan por
 * el proxy, así que la validez del host (tenant existente y activo) se
 * verifica aquí de nuevo.
 */

function allowedLegacyHosts(): string[] {
  return (process.env.GOOGLE_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function flowForHost(host: string): GoogleFlow | null {
  const hostKind = resolveTenantHost(host).kind
  return selectGoogleFlow({
    hostKind,
    // Alias del legado: solo hosts legacy/desconocidos habilitados a mano.
    // La plataforma JAMÁS se trata como legado (sería OAuth público hacia
    // cuentas tenant-less, ver google-relay «plataforma ⇒ ninguno»).
    allowedLegacyHost:
      (hostKind === "legacy" || hostKind === "unknown") &&
      allowedLegacyHosts().includes(host),
    legacyConfigured: legacyGoogleClient() !== null,
    speilinkConfigured: speilinkGoogleClient() !== null,
  })
}

/** Flujo de Google para el host de la petición; null = el botón se oculta. */
export async function googleFlowForRequest(): Promise<GoogleFlow | null> {
  return flowForHost(await requestHost())
}

/** Cliente y URI de redirección del flujo; null si dejó de estar configurado. */
export function googleKitForFlow(flow: GoogleFlow): GoogleClientKit | null {
  return googleClientKit(flow)
}

export type GoogleEntry =
  | {
      status: "ok"
      flow: GoogleFlow
      host: string
      /** Origen al que volver tras el flujo (el del panel legado o el del tenant). */
      origin: string
      /** Tenant de la cuenta nueva; null solo en el host de plataforma. */
      tenantId: string | null
      /** Slug del tenant del host; null en el flujo del panel legado. */
      tenantSlug: string | null
    }
  /** El host tiene panel pero ningún cliente de Google aplica (botón oculto). */
  | { status: "disabled"; origin: string }
  /** Host sin panel (apex/desconocido) o tenant inexistente o suspendido. */
  | { status: "not-found" }

/**
 * Resuelve el flujo para la petición actual y FIJA el contexto de tenancy
 * (§4.2 caso anónimo): la identidad se acota a las cuentas del panel de
 * este host. El flujo del panel legado conserva su URL pública (`SITE_URL`);
 * el de tenants vuelve al host de donde partió.
 */
export async function resolveGoogleEntry(): Promise<GoogleEntry> {
  const host = await requestHost()
  const resolved = resolveTenantHost(host)
  if (resolved.kind === "short" || resolved.kind === "unknown") {
    return { status: "not-found" }
  }

  const flow = flowForHost(host)
  const isTenant = resolved.kind === "tenant"

  if (isTenant) {
    const tenantId = await hostTenantIdForRequest(host)
    if (!tenantId) return { status: "not-found" }
    if (!flow) return { status: "disabled", origin: await requestOrigin() }
    setRequestContext({ tenantId, platform: false, source: "host" })
    return {
      status: "ok",
      flow,
      host,
      origin: await requestOrigin(),
      tenantId,
      tenantSlug: resolved.slug,
    }
  }

  const origin = publicOrigin()
  if (!flow) return { status: "disabled", origin }

  let tenantId: string | null = null
  if (resolved.kind === "legacy") {
    tenantId = await hostTenantIdForRequest(host)
    if (tenantId) {
      setRequestContext({ tenantId, platform: false, source: "host" })
    }
  }
  return {
    status: "ok",
    flow,
    host,
    origin,
    tenantId,
    tenantSlug: null,
  }
}
