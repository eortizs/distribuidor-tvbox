import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import {
  ALERT_ATTACHMENT_TYPES,
  MAX_ALERT_ATTACHMENT_BYTES,
  MAX_ALERT_ATTACHMENT_FILES,
  MAX_ALERT_ATTACHMENT_TOTAL_BYTES,
} from "@/lib/attachments"
import {
  MAX_ALERTS_PER_USER,
  MAX_ALERT_TEXT,
  MAX_ALERT_ERRORS,
  DEFAULT_TIME_OF_DAY,
  isValidAlertFrequency,
  isValidAlertMode,
  isValidTimeOfDay,
  isValidWeekday,
  nextCheckFrom,
  normalizeAlertSpec,
  type AlertSpec,
} from "@/lib/alertas"
import {
  checkRateLimitInterpretar,
  interpretAlertRequest,
  runAlertCheck,
  type AlertAttachmentInput,
} from "@/server/alertas/llm"
import {
  claimDueAlerts,
  deleteAlert,
  getAlert,
  getAlertById,
  insertAlertCapped,
  latestHitByAlert,
  listAlerts,
  listHits,
  markCheckOnly,
  pruneAlertHits,
  recordCheckError,
  recordHit,
  updateAlert,
  type AlertAttachmentMeta,
  type AlertHitRow,
  type AlertPatch,
  type AlertRow,
} from "@/server/alertas/repository"
import { getUserFile, userFilePath } from "@/server/storage/user-files"
import { createAlertNotification } from "@/server/notifications/service"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { pushToUserDetached } from "@/server/push/service"
import { AppError } from "@/server/umejson/types"

/**
 * Orquestación del módulo Alertas: interpretación, alta, ajustes, listado y
 * el tick del scheduler que revisa las alertas vencidas. Cada disparo avisa
 * por dos canales simultáneos, ambos mejor esfuerzo: campana (notifications +
 * SSE) y notificación de sistema Android (Web Push). Un fallo de aviso nunca
 * revierte el estado de la alerta.
 */

/** Tope de alertas procesadas por tick y concurrencia de revisión. */
const TICK_LIMIT = 10
const CHECK_CONCURRENCY = 3
/** Historial conservado por alerta; el tick poda lo más viejo. */
const HIT_RETENTION_PER_ALERT = 30

export interface AlertListItem extends AlertRow {
  lastHit: {
    kind: AlertHitRow["kind"]
    title: string
    body: string
    sources: { title: string; url: string }[]
    checkedAt: string
  } | null
}

export function limpiarTextoAlerta(input: unknown): string | null {
  if (typeof input !== "string") return null
  const texto = input.trim()
  if (!texto || texto.length > MAX_ALERT_TEXT) return null
  return texto
}

/**
 * Huella del hallazgo: sha256 del texto normalizado (sin mayúsculas ni
 * acentos ni puntuación). La misma novedad redactada distinto no vuelve a
 * avisar.
 */
function findingFingerprint(titulo: string, resumen: string): string {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  return createHash("sha256")
    .update(`${normalize(titulo)}\n${normalize(resumen)}`)
    .digest("hex")
}

/**
 * Carga los bytes de los adjuntos desde el disco del usuario. Un adjunto
 * desaparecido (borrado después de crear la alerta) se omite en silencio con
 * log: la revisión sigue con lo que haya.
 */
async function loadAttachmentInputs(
  userId: string,
  metas: readonly AlertAttachmentMeta[]
): Promise<AlertAttachmentInput[]> {
  const out: AlertAttachmentInput[] = []
  for (const meta of metas.slice(0, MAX_ALERT_ATTACHMENT_FILES)) {
    try {
      const file = await getUserFile(userId, meta.fileId)
      if (!file) continue
      const bytes = await readFile(userFilePath(file))
      out.push({
        fileName: file.fileName,
        mimeType: file.mimeType,
        // Buffer ya es un Uint8Array: una copia extra duplicaría hasta
        // 20 MB por adjunto en cada revisión.
        bytes,
      })
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `alertas: adjunto ilegible (${meta.fileId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  }
  return out
}

/** Valida la propiedad y los límites de los adjuntos elegidos. */
async function validateAttachments(
  userId: string,
  attachmentIds: unknown
): Promise<AlertAttachmentMeta[]> {
  if (attachmentIds === undefined || attachmentIds === null) return []
  if (!Array.isArray(attachmentIds)) {
    throw new AppError(422, "invalid_request", "attachmentIds debe ser una lista de ids.")
  }
  const ids = [...new Set(attachmentIds)]
  if (ids.length > MAX_ALERT_ATTACHMENT_FILES) {
    throw new AppError(
      422,
      "invalid_request",
      `Máximo ${MAX_ALERT_ATTACHMENT_FILES} adjuntos por alerta.`
    )
  }
  const metas: AlertAttachmentMeta[] = []
  let totalBytes = 0
  for (const id of ids) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new AppError(422, "invalid_request", "Id de adjunto inválido.")
    }
    const file = await getUserFile(userId, id)
    if (!file) {
      throw new AppError(422, "invalid_request", "Un adjunto ya no existe: quítalo e inténtalo de nuevo.")
    }
    if (
      !(ALERT_ATTACHMENT_TYPES as readonly string[]).includes(file.mimeType)
    ) {
      throw new AppError(
        422,
        "invalid_request",
        `"${file.fileName}" no es un tipo admitido (imágenes o PDF).`
      )
    }
    if (file.sizeBytes > MAX_ALERT_ATTACHMENT_BYTES) {
      throw new AppError(
        413,
        "file_too_large",
        `"${file.fileName}" excede el límite por archivo.`
      )
    }
    totalBytes += file.sizeBytes
    metas.push({
      fileId: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })
  }
  if (totalBytes > MAX_ALERT_ATTACHMENT_TOTAL_BYTES) {
    throw new AppError(
      413,
      "file_too_large",
      "Los adjuntos suman más del límite total por alerta."
    )
  }
  return metas
}

/*
 * ── Interpretación y alta ───────────────────────────────────────────────
 */

export async function interpretRequest(
  userId: string,
  texto: string,
  attachmentIds: unknown
): Promise<{ aclaracion: string | null; spec: AlertSpec | null }> {
  if (!checkRateLimitInterpretar(userId)) {
    throw new AppError(
      429,
      "rate_limited",
      "Has alcanzado el límite de interpretaciones por minuto. Inténtalo de nuevo en un momento."
    )
  }
  const attachments = await validateAttachments(userId, attachmentIds)
  const inputs = await loadAttachmentInputs(userId, attachments)
  return interpretAlertRequest({ texto, attachments: inputs })
}

export interface CreateAlertInput {
  texto: unknown
  spec: unknown
  attachmentIds: unknown
}

export async function createAlert(
  userId: string,
  input: CreateAlertInput
): Promise<AlertRow> {
  const texto = limpiarTextoAlerta(input.texto)
  if (!texto) {
    throw new AppError(
      422,
      "invalid_request",
      `Describe la alerta en hasta ${MAX_ALERT_TEXT} caracteres.`
    )
  }
  const normalized = normalizeAlertSpec(input.spec)
  if (!normalized.ok) {
    throw new AppError(422, "invalid_request", normalized.error)
  }
  const spec = normalized.spec

  const attachments = await validateAttachments(userId, input.attachmentIds)
  const nextCheckAt =
    spec.kind === "reminder"
      ? new Date(spec.remindAt as string)
      : new Date(
          nextCheckFrom(
            spec.frequency as Exclude<AlertSpec["frequency"], null>,
            spec.timeOfDay as string,
            spec.weekday,
            Date.now()
          )
        )

  const created = await insertAlertCapped(
    {
      userId,
      spec,
      sourceRequest: texto,
      attachments,
      nextCheckAt,
    },
    MAX_ALERTS_PER_USER
  )
  if (!created) {
    throw new AppError(
      422,
      "alerts_limit_reached",
      `Ya tienes ${MAX_ALERTS_PER_USER} alertas activas. Pausa o borra alguna para crear otra.`
    )
  }
  notifyAlertsChanged(userId)
  return created
}

/*
 * ── Listado y detalle ───────────────────────────────────────────────────
 */

export async function listAlertsSummary(
  userId: string
): Promise<AlertListItem[]> {
  const [alerts, latest] = await Promise.all([
    listAlerts(userId),
    latestHitByAlert(userId),
  ])
  return alerts.map((alert) => {
    const hit = latest.get(alert.id)
    return {
      ...alert,
      lastHit: hit
        ? {
            kind: hit.kind,
            title: hit.title,
            body: hit.body,
            sources: hit.sources,
            checkedAt: hit.checkedAt,
          }
        : null,
    }
  })
}

export async function getAlertDetail(
  userId: string,
  alertId: string
): Promise<{ alert: AlertRow; hits: AlertHitRow[] }> {
  const alert = await getAlert(userId, alertId)
  if (!alert) {
    throw new AppError(404, "alert_not_found", "La alerta no existe.")
  }
  const hits = await listHits(userId, alertId)
  return { alert, hits }
}

/*
 * ── Ajustes ─────────────────────────────────────────────────────────────
 */

export interface PatchAlertInput {
  status?: unknown
  frequency?: unknown
  timeOfDay?: unknown
  weekday?: unknown
  mode?: unknown
  remindAt?: unknown
}

export async function patchAlert(
  userId: string,
  alertId: string,
  input: PatchAlertInput
): Promise<AlertRow> {
  const alert = await getAlert(userId, alertId)
  if (!alert) {
    throw new AppError(404, "alert_not_found", "La alerta no existe.")
  }
  if (alert.status === "done") {
    throw new AppError(
      422,
      "alert_done",
      "La alerta ya se completó; crea una nueva si quieres seguir vigilando."
    )
  }

  const patch: AlertPatch = {}

  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "paused") {
      throw new AppError(422, "invalid_request", "status debe ser 'active' o 'paused'.")
    }
    patch.status = input.status
  }

  if (alert.kind === "search") {
    const frequency = input.frequency !== undefined ? input.frequency : alert.frequency
    if (!isValidAlertFrequency(frequency)) {
      throw new AppError(422, "invalid_request", "Frecuencia inválida.")
    }
    let timeOfDay: string | null
    if (isValidTimeOfDay(input.timeOfDay)) {
      timeOfDay = input.timeOfDay
    } else if (input.timeOfDay !== undefined) {
      // Hora inválida del cliente: se descarta y se recalcula.
      timeOfDay =
        frequency === "daily" || frequency === "weekly"
          ? DEFAULT_TIME_OF_DAY
          : null
    } else {
      timeOfDay = isValidTimeOfDay(alert.timeOfDay)
        ? alert.timeOfDay
        : frequency === "daily" || frequency === "weekly"
          ? DEFAULT_TIME_OF_DAY
          : null
    }
    let weekday =
      input.weekday !== undefined && isValidWeekday(input.weekday)
        ? input.weekday
        : alert.weekday
    if (!isValidWeekday(weekday)) weekday = null
    if (frequency !== "daily" && frequency !== "weekly") {
      timeOfDay = null
      weekday = null
    }
    if (frequency === "weekly" && weekday === null) {
      throw new AppError(422, "invalid_request", "Elige el día de la semana.")
    }
    const mode = input.mode !== undefined ? input.mode : alert.mode
    if (!isValidAlertMode(mode)) {
      throw new AppError(422, "invalid_request", "Modo inválido.")
    }
    patch.frequency = frequency
    patch.timeOfDay = timeOfDay
    patch.weekday = weekday
    patch.mode = mode
    // Reanudar o cambiar el schedule revisa pronto: la próxima corrida se
    // calcula desde ahora.
    if (patch.status === "active" || input.frequency !== undefined || input.timeOfDay !== undefined || input.weekday !== undefined) {
      patch.nextCheckAt = new Date(
        nextCheckFrom(frequency, timeOfDay as string, weekday, Date.now())
      )
    }
  } else {
    if (input.remindAt !== undefined) {
      const parsed = typeof input.remindAt === "string" ? Date.parse(input.remindAt) : Number.NaN
      if (!Number.isFinite(parsed) || parsed <= Date.now() + 60_000) {
        throw new AppError(
          422,
          "invalid_request",
          "La fecha del recordatorio debe estar en el futuro."
        )
      }
      const remindAt = new Date(parsed)
      patch.remindAt = remindAt
      patch.nextCheckAt = remindAt
    } else if (patch.status === "active") {
      // Reanudar un recordatorio pausado solo tiene sentido con fecha válida.
      const remindAt = alert.remindAt ? Date.parse(alert.remindAt) : Number.NaN
      if (!Number.isFinite(remindAt) || remindAt <= Date.now()) {
        throw new AppError(
          422,
          "invalid_request",
          "El recordatorio tiene una fecha pasada: ajusta la fecha y hora."
        )
      }
      patch.nextCheckAt = new Date(remindAt)
    }
  }

  if (patch.status === "active") {
    // Reactivar (desde error o pausa) limpia el conteo de fallos.
    patch.errorCount = 0
    patch.lastError = null
  }

  const updated = await updateAlert(userId, alertId, patch)
  if (!updated) {
    throw new AppError(404, "alert_not_found", "La alerta no existe.")
  }
  notifyAlertsChanged(userId)
  return updated
}

export async function deleteAlertById(
  userId: string,
  alertId: string
): Promise<void> {
  const deleted = await deleteAlert(userId, alertId)
  if (!deleted) {
    throw new AppError(404, "alert_not_found", "La alerta no existe.")
  }
  notifyAlertsChanged(userId)
}

/*
 * ── Push ────────────────────────────────────────────────────────────────
 */

/* El aviso de prueba lo envía la ruta `/api/push/test` directamente con
 * `sendPushToUser`: un solo dueño para el payload de prueba.
 */

/*
 * ── Scheduler ───────────────────────────────────────────────────────────
 */

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

function logTickError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `alertas: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

/**
 * Avisa por SSE que las alertas del usuario cambiaron (creación, ajuste,
 * borrado o resolución del scheduler): los otros dispositivos con el módulo
 * abierto refrescan el listado en vivo. Fire-and-forget, como el aviso de
 * campana.
 */
function notifyAlertsChanged(userId: string): void {
  publishRealtimeDetached({ kind: "alerts", distribuidorId: userId })
}

/** Texto del último hallazgo notificado, para que el check compare. */
async function previousFindingText(
  userId: string,
  alertId: string
): Promise<string | null> {
  const hits = await listHits(userId, alertId, 5)
  const lastNotified = hits.find(
    (hit) => hit.notified && (hit.kind === "hit" || hit.kind === "reminder")
  )
  if (!lastNotified) return null
  return `${lastNotified.title}. ${lastNotified.body}`.slice(0, 600)
}

async function deliverAlertNotice(input: {
  userId: string
  alertId: string
  kind: "alert_hit" | "reminder"
  title: string
  body: string
}): Promise<void> {
  createAlertNotification({
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
  })
  pushToUserDetached(input.userId, {
    title: input.title,
    body: input.body,
    url: "/modulos/alertas",
    tag: input.alertId,
  })
}

async function fireReminder(alert: AlertRow): Promise<void> {
  const body = alert.sourceRequest.slice(0, 400)
  await deliverAlertNotice({
    userId: alert.userId,
    alertId: alert.id,
    kind: "reminder",
    title: `Recordatorio: ${alert.title}`,
    body,
  })
  await recordHit({
    alertId: alert.id,
    userId: alert.userId,
    kind: "reminder",
    title: alert.title,
    body,
    sources: [],
    notified: true,
    countsAsHit: true,
    nextCheckAt: new Date(),
    status: "done",
  })
}

/** Procesa una alerta vencida; devuelve el usuario afectado (o null si no
 * había nada que hacer) para que el tick avise por SSE a sus dispositivos. */
async function processAlert(alertId: string): Promise<string | null> {
  const alert = await getAlertById(alertId)
  if (!alert || alert.status !== "active") return null

  if (alert.kind === "reminder") {
    await fireReminder(alert)
    return alert.userId
  }

  const nextCheckAt = new Date(
    nextCheckFrom(
      alert.frequency as Exclude<AlertRow["frequency"], null>,
      alert.timeOfDay as string,
      alert.weekday,
      Date.now()
    )
  )

  let result
  try {
    const attachments = await loadAttachmentInputs(alert.userId, alert.attachments)
    result = await runAlertCheck({
      title: alert.title,
      query: alert.query as string,
      sourceRequest: alert.sourceRequest,
      previousFinding: await previousFindingText(alert.userId, alert.id),
      attachments,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCount = alert.errorCount + 1
    const paused = errorCount >= MAX_ALERT_ERRORS
    logTickError(`check (${alert.id})`, error)
    await recordCheckError(alert.id, errorCount, message, nextCheckAt, paused ? "error" : undefined)
    if (paused) {
      await deliverAlertNotice({
        userId: alert.userId,
        alertId: alert.id,
        kind: "alert_hit",
        title: `Alerta pausada: ${alert.title}`,
        body: `La revisión falló ${MAX_ALERT_ERRORS} veces seguidas (${message.slice(0, 200)}). Reanúdala desde el módulo Alertas cuando quieras.`,
      }).catch(() => {})
      // El aviso también deja registro en el historial.
      await recordHit({
        alertId: alert.id,
        userId: alert.userId,
        kind: "error",
        title: "Alerta pausada por errores",
        body: message.slice(0, 400),
        sources: [],
        notified: true,
        countsAsHit: false,
        nextCheckAt,
        status: "error",
        errorCount,
        lastError: message,
      }).catch(() => {})
    }
    return alert.userId
  }

  if (!result.encontrado) {
    await markCheckOnly(alert.id, nextCheckAt)
    return alert.userId
  }

  const fingerprint = findingFingerprint(result.titulo, result.resumen)
  const isRepeat = fingerprint === alert.lastFindingFingerprint
  const notify = alert.mode === "once" || !isRepeat

  if (notify) {
    await deliverAlertNotice({
      userId: alert.userId,
      alertId: alert.id,
      kind: "alert_hit",
      title: `Alerta: ${result.titulo}`,
      body: result.resumen,
    })
  }

  await recordHit({
    alertId: alert.id,
    userId: alert.userId,
    kind: "hit",
    title: result.titulo,
    body: result.nota ? `${result.resumen} (${result.nota})` : result.resumen,
    sources: result.fuentes,
    fingerprint,
    notified: notify,
    countsAsHit: true,
    nextCheckAt,
    status: alert.mode === "once" ? "done" : undefined,
    // La revisión fue exitosa: el conteo de fallos consecutivos arranca de
    // nuevo aunque el hallazgo vaya deduplicado sin aviso.
    errorCount: 0,
    lastError: null,
    lastFindingFingerprint: fingerprint,
  })
  return alert.userId
}

/**
 * Un tick del scheduler: dispara primero el carril rápido de recordatorios
 * (operaciones de base, sin LLM) y después las búsquedas vencidas con
 * concurrencia acotada — los checks tardan hasta 45 s y no deben retrasar
 * los recordatorios que piden precisión de minuto. Nunca lanza: los fallos
 * por alerta quedan logueados.
 */
export async function alertasSchedulerTick(): Promise<void> {
  const reminderIds = await claimDueAlerts(TICK_LIMIT, "reminder")
  for (const id of reminderIds) {
    const userId = await processAlert(id).catch((error: unknown) => {
      logTickError(`process (${id})`, error)
      return null
    })
    if (userId) notifyAlertsChanged(userId)
  }

  const searchIds = await claimDueAlerts(TICK_LIMIT, "search")
  for (const batch of chunk(searchIds, CHECK_CONCURRENCY)) {
    const userIds = await Promise.all(
      batch.map((id) =>
        processAlert(id).catch((error: unknown) => {
          logTickError(`process (${id})`, error)
          return null
        })
      )
    )
    for (const userId of userIds) {
      if (userId) notifyAlertsChanged(userId)
    }
  }

  // Retención del historial: best effort en los ticks con actividad.
  if (reminderIds.length > 0 || searchIds.length > 0) {
    try {
      await pruneAlertHits(HIT_RETENTION_PER_ALERT)
    } catch (error) {
      logTickError("prune", error)
    }
  }
}
