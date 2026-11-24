import { headers } from "next/headers"

import { systemPool } from "@/server/db"
import { AppError } from "@/server/umejson/types"
import { createTenant } from "@/server/tenants/platform"
import { createSignupHandoff } from "@/server/onboarding/handoff"
import { tenantHostForSlug } from "@/server/tenant/hosts"
import { findTenantBySlug } from "@/server/tenant/context"
import {
  PUBLIC_RESERVED_SLUGS,
  slugAvailabilityShape,
  slugify,
} from "@/lib/tenant-slug"

/**
 * Núcleo del registro público de negocios (Fase 1, §4.1 del plan). Lo
 * consumen la acción de servidor (formulario del apex) y el fallback
 * `POST /api/onboarding/signup` — MISMA validación, topes y alta para los dos
 * caminos. El interruptor `SELF_SIGNUP_ENABLED` (default off) mantiene el
 * registro apagado hasta que el dueño lo abra.
 */

export interface BusinessSignupInput {
  businessName: string
  slug: string
  fullName: string
  email: string
  password: string
  /** Casilla de términos y privacidad: obligatoria. */
  legal: boolean
  /** Honeypot: con contenido se rechaza en silencio. */
  website?: string
}

export type BusinessSignupResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** El registro directo vive tras un interruptor: cerrado por defecto. */
export function selfSignupEnabled(): boolean {
  return (process.env.SELF_SIGNUP_ENABLED || "off").toLowerCase() === "on"
}

/** Tope global de altas por día (default 50). */
function dailyCap(): number {
  const parsed = Number(process.env.SELF_SIGNUP_DAILY_CAP)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 50
}

export function slugValidationError(slug: string): string | null {
  const shape = slugAvailabilityShape(slug)
  if (!shape.available) {
    return shape.reason === "reservado"
      ? "Ese subdominio está reservado. Elige otro."
      : "El subdominio debe tener 3-30 caracteres (letras, dígitos y guiones), sin guiones al inicio o al final."
  }
  return null
}

// ---------------------------------------------------------------------------
// Tope por IP (5 altas/hora): bucket en memoria. El registro corre en un solo
// proceso (pm2), así que la memoria basta; el tope global diario va a BD.
// ---------------------------------------------------------------------------

const IP_BUCKET_MAX = 5000
const IP_WINDOW_MS = 60 * 60 * 1000
const IP_MAX_SIGNUPS = 5
const ipBuckets = new Map<string, number[]>()

function pruneIpBuckets(now: number): void {
  if (ipBuckets.size <= IP_BUCKET_MAX) return
  for (const [key, stamps] of ipBuckets) {
    const fresh = stamps.filter((t) => now - t < IP_WINDOW_MS)
    if (fresh.length === 0) ipBuckets.delete(key)
    else ipBuckets.set(key, fresh)
  }
}

function ipRateLimited(ip: string): boolean {
  const now = Date.now()
  pruneIpBuckets(now)
  const stamps = (ipBuckets.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS)
  if (stamps.length >= IP_MAX_SIGNUPS) {
    ipBuckets.set(ip, stamps)
    return true
  }
  stamps.push(now)
  ipBuckets.set(ip, stamps)
  return false
}

async function dailyCapReached(): Promise<boolean> {
  const result = await systemPool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM tenants
      WHERE kind = 'business'
        AND created_at > now() - interval '24 hours'`
  )
  return Number(result.rows[0]?.n ?? 0) >= dailyCap()
}

/** IP real del llamador (Cloudflare fija cf-connecting-ip; XFF de respaldo). */
export async function signupCallerIp(): Promise<string> {
  const h = await headers()
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

/**
 * Alta completa: validación → topes → honeypot → createTenant (atómico) →
 * ticket de entrega. Devuelve la URL de canje en el subdominio (el llamador
 * hace redirect; en acciones Next exige redirect() fuera del try/catch).
 */
export async function performBusinessSignup(
  input: BusinessSignupInput,
  ip: string
): Promise<BusinessSignupResult> {
  if (!selfSignupEnabled()) {
    return { ok: false, error: "El registro aún no está abierto. Vuelve pronto." }
  }
  if (ipRateLimited(ip)) {
    return {
      ok: false,
      error: "Demasiados intentos desde tu conexión. Inténtalo de nuevo en una hora.",
    }
  }
  // Honeypot: los bots rellenan campos ocultos. Rechazo en silencio con un
  // mensaje genérico (sin revelar el mecanismo).
  if ((input.website ?? "").trim().length > 0) {
    return { ok: false, error: "No fue posible crear la cuenta." }
  }
  if (await dailyCapReached()) {
    return {
      ok: false,
      error: "Alcanzamos el tope de registros por hoy. Inténtalo mañana.",
    }
  }

  const businessName = input.businessName.trim().replace(/\s+/g, " ")
  const fullName = input.fullName.trim().replace(/\s+/g, " ")
  const email = input.email.trim().toLowerCase()
  const slug = input.slug.trim().toLowerCase()
  const password = input.password

  if (businessName.length < 1 || businessName.length > 80) {
    return { ok: false, error: "El nombre del negocio debe tener entre 1 y 80 caracteres." }
  }
  if (fullName.length < 1 || fullName.length > 100) {
    return { ok: false, error: "Escribe tu nombre completo." }
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Ingresa un correo electrónico válido." }
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, error: "La contraseña debe tener entre 8 y 128 caracteres." }
  }
  if (!input.legal) {
    return {
      ok: false,
      error: "Debes aceptar los Términos de Uso y el Aviso de Privacidad.",
    }
  }

  const slugError = slugValidationError(slug)
  if (slugError) return { ok: false, error: slugError }

  try {
    if (await findTenantBySlug(slug)) {
      return {
        ok: false,
        error: `El subdominio '${slug}' ya está ocupado. Elige otro.`,
      }
    }
    const created = await createTenant({
      name: businessName,
      slug,
      ownerEmail: email,
      ownerPassword: password,
      ownerFullName: fullName,
    })
    const handoff = await createSignupHandoff(created.tenantId, created.ownerId)
    const url = new URL(
      "/onboarding/continuar",
      `https://${tenantHostForSlug(created.slug)}`
    )
    url.searchParams.set("ticket", handoff.token)
    return { ok: true, redirectUrl: url.toString() }
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "email_taken") {
        return {
          ok: false,
          error:
            "Ese correo ya está registrado. Si ya tienes cuenta en otro panel, inicia sesión allí o usa otro correo.",
        }
      }
      if (error.code === "slug_tomado" || error.code === "slug_invalido") {
        return { ok: false, error: "Ese subdominio no está disponible. Elige otro." }
      }
      return { ok: false, error: error.message }
    }
    throw error
  }
}

/** Sugerencia de slug desde el nombre (la UI la propone editable). */
export function suggestSlug(businessName: string): string {
  return slugify(businessName)
}

/** Disponibilidad real del slug (BD + forma + reservados). */
export async function checkSlugAvailability(
  slug: string
): Promise<
  { available: true } | { available: false; reason: "forma" | "reservado" | "ocupado" }
> {
  const shape = slugAvailabilityShape(slug)
  if (!shape.available) return shape
  if (PUBLIC_RESERVED_SLUGS.has(slug.trim().toLowerCase())) {
    return { available: false, reason: "reservado" }
  }
  const taken = await findTenantBySlug(slug.trim().toLowerCase())
  return taken ? { available: false, reason: "ocupado" } : { available: true }
}
