import { sendNotification } from "web-push"

import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  touchPushSubscription,
} from "@/server/alertas/repository"

/**
 * Web Push (VAPID) del módulo Alertas: notificación de sistema simultánea a
 * la campana cuando una alerta dispara. En Android (Chrome/Edge/Samsung) el
 * navegador la entrega de forma nativa vía su push service (FCM por debajo,
 * sin proyecto Firebase propio). Es mejor esfuerzo: un fallo de push nunca
 * revierte ni retrasa el hallazgo ni la campana; las suscripciones muertas
 * (404/410 del push service) se borran para no reintentarlas.
 *
 * Sin llaves VAPID configuradas el módulo queda en modo campana-sola: la UI
 * deshabilita el control «Avisos en este dispositivo» con explicación.
 */

export interface PushPayload {
  title: string
  body: string
  /** Ruta interna que se abre al tocar el aviso. */
  url: string
  /** Colapso en Android: misma alerta = un solo aviso visible. */
  tag?: string
}

function vapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey }
}

export function pushConfigured(): boolean {
  return vapidKeys() !== null
}

/** Llave pública para el cliente (`applicationServerKey` del subscribe). */
export function vapidPublicKeyForClient(): string | null {
  return vapidKeys()?.publicKey ?? null
}

function vapidDetails(): { subject: string; publicKey: string; privateKey: string } | null {
  const keys = vapidKeys()
  if (!keys) return null
  return {
    subject: process.env.VAPID_SUBJECT?.trim() || "mailto:alertas@people-ia.com",
    ...keys,
  }
}

function logError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `push: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

/**
 * Push services reales de los navegadores: el endpoint lo entrega el
 * navegador al suscribirse, así que solo aceptamos estos hosts por https.
 * Guardar URLs arbitrarias convertiría cada disparo (y «Probar aviso») en un
 * sondeo del servidor hacia cualquier destino.
 */
const PUSH_ENDPOINT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "autoupdate.push.services.mozilla.com",
])

export function isValidPushEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return false
    const host = url.hostname.toLowerCase()
    return (
      PUSH_ENDPOINT_HOSTS.has(host) ||
      host.endsWith(".push.services.mozilla.com")
    )
  } catch {
    return false
  }
}

/** Codigos HTTP del push service que marcan la suscripción como muerta. */
const DEAD_STATUS_CODES = new Set([404, 410])

async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  const details = vapidDetails()
  if (!details) return 0

  const subscriptions = await listPushSubscriptions(userId)
  if (subscriptions.length === 0) return 0

  let delivered = 0
  await Promise.all(
    subscriptions.map(async (subscription) => {
      // Defensa en profundidad: un endpoint no permitido no se marca nunca.
      if (!isValidPushEndpoint(subscription.endpoint)) return
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          // Sin `timeout`, web-push no corta el socket: un push service
          // colgado bloquearía el fan-out y la petición que espera.
          { vapidDetails: details, timeout: 10_000 }
        )
        delivered += 1
        await touchPushSubscription(subscription.id)
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode !== undefined && DEAD_STATUS_CODES.has(statusCode)) {
          await deletePushSubscriptionByEndpoint(subscription.endpoint)
          return
        }
        logError(`send (${statusCode ?? "sin estado"})`, error)
      }
    })
  )
  return delivered
}

/** Envío mejor esfuerzo: registra y nunca lanza (contrato de las notificaciones). */
export function pushToUserDetached(userId: string, payload: PushPayload): void {
  void sendToUser(userId, payload).catch((error: unknown) =>
    logError("detached", error)
  )
}

/** Igual, pero esperando: lo usa «Probar aviso» para reportar el resultado. */
export function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  return sendToUser(userId, payload)
}
