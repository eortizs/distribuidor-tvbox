/**
 * Slug de negocio del registro público (Fase 1, §4.1 del plan). MÓDULO PURO:
 * sin BD ni env ni Next — lo usan el formulario del apex (sugerencia y
 * validación en vivo) y el endpoint de disponibilidad del servidor.
 *
 * La regla de FORMA es la del catálogo (`db/tenants-schema.sql`); la lista de
 * reservados públicos añade marca, soporte e impersonación de marca SOLO al
 * registro (la consola de plataforma no cambia).
 */

/** Regla del catálogo (db/tenants-schema.sql): forma del slug. */
export const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/**
 * Reservados públicos del registro: marca, soporte e impersonación. El
 * registro jamás crea estos slugs (la consola conserva su catálogo propio).
 */
export const PUBLIC_RESERVED_SLUGS = new Set([
  "spei",
  "speilink",
  "spei-link",
  "soporte",
  "ayuda",
  "support",
  "admin",
  "administrador",
  "plataforma",
  "whatsapp",
  "mercado",
  "mercadopago",
  "mercado-pago",
  "banxico",
])

export type SlugAvailability =
  | { available: true }
  | { available: false; reason: "forma" | "reservado" | "ocupado" }

/** Forma + reservados públicos (la ocupación la resuelve el servidor con BD). */
export function slugAvailabilityShape(slug: string): SlugAvailability {
  const normalized = slug.trim().toLowerCase()
  if (!TENANT_SLUG_RE.test(normalized)) {
    return { available: false, reason: "forma" }
  }
  if (PUBLIC_RESERVED_SLUGS.has(normalized)) {
    return { available: false, reason: "reservado" }
  }
  return { available: true }
}

/**
 * Sugerencia de slug desde el nombre del negocio: minúsculas, sin acentos,
 * no alfanumérico → `-`, guiones colapsados, sin guiones en los extremos.
 * Vacío si el nombre no produce nada utilizable (el campo queda editable).
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
}
