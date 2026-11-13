import type { NextRequest } from "next/server"

import { getAccountDistribuidorName } from "@/server/auth/accounts"
import {
  findSessionUser,
  readSessionCookie,
} from "@/server/auth/session-lookup"
import {
  subscribeRealtime,
  type RealtimeEvent,
} from "@/server/realtime/bus"
import { pool } from "@/server/db"

/**
 * Stream de invalidación en tiempo real (Server-Sent Events).
 *
 * Autenticado por la cookie de sesión; el servidor filtra cada evento según
 * el alcance de la conexión antes de enviarlo, así que el cliente nunca
 * decide qué ve. Solo viajan señales (kind + ids): los datos los trae cada
 * cliente al refrescar, por los cauces ya autorizados (RSC / API).
 *
 * Cloudflare corta respuestas idle a los ~100 s: el heartbeat de 25 s mantiene
 * el stream abierto y detecta conexiones muertas. `no-transform` y
 * `X-Accel-Buffering: no` evitan buffering intermedio (Caddy/Cloudflare).
 */

const HEARTBEAT_INTERVAL_MS = 25_000

interface SessionScope {
  userId: string
  isAdmin: boolean
  /** Reseller FlujoTV ligado a la cuenta del distribuidor; null si no hay. */
  distribuidorName: string | null
}

function inScope(scope: SessionScope, event: RealtimeEvent): boolean {
  // Preferencias, notificaciones y alertas: solo las del propio usuario, sea
  // cual sea el rol — ni siquiera un admin recibe las de otras cuentas.
  if (
    event.kind === "prefs" ||
    event.kind === "notifications" ||
    event.kind === "alerts"
  ) {
    return event.distribuidorId === scope.userId
  }
  if (scope.isAdmin) return true
  switch (event.kind) {
    // Entidades: la propia cuenta del usuario (distribuidorId) o los datos
    // ligados a su reseller (distribuidorName). Sin dueño resolvable, solo admin.
    case "entity":
      return (
        (event.distribuidorId != null &&
          event.distribuidorId === scope.userId) ||
        (event.distribuidor != null &&
          event.distribuidor === scope.distribuidorName)
      )
    // Gastos: solo los del propio usuario (el listado va por user_id).
    case "expenses":
      return event.distribuidorId === scope.userId
    // Usuarios/permisos: solo los que tocan la propia cuenta.
    case "users":
      return event.entityId === scope.userId
    // Órdenes de Mercado Pago: el refetch es seguro y ya llega filtrado
    // por alcance; avisar a todos evita resolver la titularidad aquí.
    case "mp_order":
      return true
  }
}

export async function GET(request: NextRequest) {
  const token = readSessionCookie(request.headers.get("cookie"))
  const session = token ? await findSessionUser(pool, token) : null
  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  const distribuidorName =
    session.role === "admin"
      ? null
      : await getAccountDistribuidorName(session.id)
  const scope: SessionScope = {
    userId: session.id,
    isAdmin: session.role === "admin",
    distribuidorName,
  }

  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  let closed = false

  const cleanup = (): void => {
    if (closed) return
    closed = true
    if (heartbeat !== null) clearInterval(heartbeat)
    heartbeat = null
    unsubscribe?.()
    unsubscribe = null
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      send(": connected\n\n")

      unsubscribe = subscribeRealtime((event) => {
        if (!inScope(scope, event)) return
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`)
      })

      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_INTERVAL_MS)

      request.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // El runtime ya cerró el stream.
        }
      })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
