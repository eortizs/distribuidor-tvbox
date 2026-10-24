/**
 * Contrato de datos de la API FlujoTV tal como lo consume el panel.
 *
 * Los tipos viven fuera de `src/server` porque la interfaz los usa también:
 * la API responde con formas heterogéneas y el servidor las normaliza aquí en
 * un modelo estable (estado, vencimiento, días restantes) antes de llegar al
 * navegador.
 */

export type FlujoKeySource = "ajustes" | "env" | "file" | null

export interface FlujoClient {
  /** Identificador estable de la fila: el nombre de usuario si existe. */
  id: string
  userName: string
  email: string | null
  status: string | null
  /** Estado normalizado: activo, vencido, pendiente u otro. */
  statusLabel: string
  expiresAt: string | null
  daysRemaining: number | null
  plan: string | null
  hasCredentials: boolean
  password: string | null
  notes: string | null
  raw: Record<string, unknown>
}

export interface FlujoLicenseRecord {
  id: string
  userName: string | null
  months: number | null
  amount: number | null
  currency: string | null
  issuedAt: string | null
  expiresAt: string | null
  status: string | null
  raw: Record<string, unknown>
}

export interface FlujoHealth {
  reachable: boolean
  status: string | null
  version: string | null
  error: string | null
}

export interface FlujoStatus {
  configured: boolean
  baseUrl: string
  keySource: FlujoKeySource
  maskedKey: string | null
  /** Última actualización de la clave guardada en el panel. */
  updatedAt: string | null
  health: FlujoHealth
}

export interface FlujoClientsResponse {
  clients: FlujoClient[]
  total: number | null
  /** Endpoint efectivo que respondió, por si hubo que reintentar. */
  endpoint: string
}

export interface FlujoLicensesResponse {
  licenses: FlujoLicenseRecord[]
  endpoint: string
}

export interface FlujoRenewalResult {
  status: number
  durationMs: number
  payload: unknown
}

export interface FlujoRawResult {
  status: number
  durationMs: number
  headers: Record<string, string>
  payload: unknown
}

export const RENEWAL_MONTHS = [1, 3, 6, 12] as const

export type RenewalMonths = (typeof RENEWAL_MONTHS)[number]

export function isRenewalMonths(value: unknown): value is RenewalMonths {
  return (
    typeof value === "number" &&
    (RENEWAL_MONTHS as readonly number[]).includes(value)
  )
}

/** Variante del badge para un estado normalizado de licencia. */
export function statusBadgeVariant(
  status: string | null
): "success-light" | "warning-light" | "destructive-light" | "info-light" | "outline" {
  switch (status) {
    case "activo":
      return "success-light"
    case "vencido":
      return "destructive-light"
    case "pendiente":
      return "warning-light"
    case "prueba":
      return "info-light"
    default:
      return "outline"
  }
}

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeZone: "America/Mexico_City",
})

export function formatFlujoDate(value: string | null): string {
  if (!value) return "—"
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return dateFormatter.format(new Date(parsed))
}

/** Días restantes: texto corto con el matiz de urgencia. */
export function formatDaysRemaining(days: number | null): string {
  if (days === null) return "—"
  if (days < 0) return `vencido hace ${Math.abs(days)} d`
  if (days === 0) return "vence hoy"
  if (days === 1) return "vence mañana"
  if (days <= 30) return `${days} días`
  return `${days} días`
}
