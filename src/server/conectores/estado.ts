import { compareConstante, crearEstadoAleatorio } from "@/server/conectores/crypto"

/**
 * Estado anti-CSRF del flujo de conectores, en una cookie httpOnly de
 * corta vida. El valor es `<connectorId>.<aleatorio>`: el callback compara
 * el valor completo en tiempo constante y toma el conector de la cookie
 * (servidor, no del parámetro), así que un flujo iniciado no puede
 * canjearse para otro conector ni desde otro navegador.
 */

const STATE_TTL_SECONDS = 600

export function conectorStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  }
}

export function crearEstadoConector(connectorId: string): string {
  return `${connectorId}.${crearEstadoAleatorio()}`
}

/** Valida cookie contra parámetro y devuelve el conector del flujo. */
export function verifyEstadoConector(
  expected: string | undefined,
  received: string | null
): { connectorId: string } | null {
  if (!expected || !received) return null
  if (!compareConstante(expected, received)) return null
  const dot = expected.indexOf(".")
  if (dot === -1) return null
  const connectorId = expected.slice(0, dot)
  return connectorId ? { connectorId } : null
}
