/**
 * Costo de búsqueda pendiente de prorratear: la ruta rápida de "Insertar
 * detalles" (grounding) cuesta dinero por sí sola —no va dentro de ninguna
 * generación—, así que su costo se acumula por usuario y se carga a la
 * primera generación que haga después con ese prompt. Ventana de 30 minutos:
 * si el usuario nunca genera, el costo se absorbe (el gasto real ya ocurrió).
 * El proceso es único (pm2 fork), así que el mapa en memoria es suficiente.
 */

const ACCRUAL_TTL_MS = 30 * 60 * 1000

const accrued = new Map<string, { amount: number; at: number }>()

function prune(now: number): void {
  for (const [userId, entry] of accrued) {
    if (now - entry.at > ACCRUAL_TTL_MS) accrued.delete(userId)
  }
}

/** Acumula un costo de detalles para prorratearlo a la próxima generación. */
export function accrueDetailsCost(userId: string, amount: number): void {
  if (!(amount > 0)) return
  const now = Date.now()
  prune(now)
  const prev = accrued.get(userId)
  const base = prev && now - prev.at <= ACCRUAL_TTL_MS ? prev.amount : 0
  accrued.set(userId, { amount: base + amount, at: now })
}

/** Consume el costo acumulado del usuario (una sola vez); null si no hay. */
export function consumeDetailsCost(userId: string): number | null {
  const now = Date.now()
  prune(now)
  const entry = accrued.get(userId)
  if (!entry || now - entry.at > ACCRUAL_TTL_MS) return null
  accrued.delete(userId)
  return entry.amount
}
