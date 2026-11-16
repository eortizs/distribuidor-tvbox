import type { AuthUser } from "@/server/auth/types"
import { pool } from "@/server/db"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  isCouponQaEnabled,
  licensePriceMxnOrNull,
} from "@/server/mercadopago/config"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import {
  createCouponOrder,
  type CreatedCouponOrder,
} from "@/server/mercadopago/service"
import { getSaldosActual } from "@/server/saldo/service"

import {
  appendConversationMessage,
  type AssistantChannel,
} from "./conversations"
import type { AssistantAttachmentMeta } from "./attachments"
import { assistantRenewalRequestId } from "./tools"
import { clienteEstadoLinea } from "./renovacion"

/*
 * Renovación pagada con CUPÓN desde el chat (`/tv3<usuario> -c`), en el
 * Asistente de la PWA y en el agente de WhatsApp (misma conversación, mismo
 * estado pendiente): réplica a dos pasos del sheet de cupón de /clientes
 * reusando el mismo fondo — createCouponOrder valida el código, debita
 * `users.saldo_cupones`, aplica los topes por comprador, la guardia
 * anti-doble-renovación y dispara la renovación DESACOPLADA (respuesta
 * `pending` + notificación por campana/WhatsApp).
 *
 *   Paso 1 — `/tv3baltazar -c`: busca al cliente (guarda de alcance de las
 *   compras), valida precio configurado, cupón habilitado y saldo en cupones
 *   suficiente ANTES de pedir nada, y deja el prompt pendiente (una fila por
 *   usuario en `assistant_coupon_prompts`, vigente 10 minutos).
 *
 *   Paso 2 — el comprador escribe SOLO el código (ej. `0000`):
 *   maybeHandleCouponRedemption intercepta el turno (antes del modelo y antes
 *   del interceptor de transferencias), canjea con el MISMO request_id
 *   determinista de la herramienta canjear_renovacion (replay-safe dentro de
 *   la hora) y responde el resultado. `cancelar` aborta.
 *
 * Sin prompt pendiente el interceptor devuelve null y el turno sigue su
 * curso normal: nunca secuestra mensajes ajenos al canje.
 */

/** Vigencia del prompt de código: 10 minutos desde su creación. */
const PROMPT_TTL_MS = 10 * 60 * 1000

/** Forma del código de cupón que el comprador puede escribir (0000, 1010…). */
const COUPON_CODE_SHAPE = /^[0-9]{4,8}$/

/** Palabras que cancelan el prompt pendiente. */
const CANCEL_WORDS = new Set(["cancelar", "cancel"])

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    })
  )
}

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8)
}

/** true si los args del comando dinámico piden el método de pago cupón. */
export function isCuponFlag(args: string): boolean {
  return args.trim().toLowerCase() === "-c"
}

/* --------------------------- Prompt pendiente ---------------------------- */

interface CouponPrompt {
  userName: string
  createdAt: Date
}

async function upsertCouponPrompt(
  userId: string,
  userName: string
): Promise<void> {
  await pool.query(
    `INSERT INTO assistant_coupon_prompts (user_id, user_name, created_at)
     VALUES ($1::uuid, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET user_name = EXCLUDED.user_name, created_at = now()`,
    [userId, userName]
  )
}

async function getCouponPrompt(userId: string): Promise<CouponPrompt | null> {
  const result = await pool.query<{
    user_name: string
    created_at: Date
  }>(
    "SELECT user_name, created_at FROM assistant_coupon_prompts WHERE user_id = $1::uuid",
    [userId]
  )
  const row = result.rows[0]
  return row ? { userName: row.user_name, createdAt: row.created_at } : null
}

async function deleteCouponPrompt(userId: string): Promise<void> {
  await pool.query("DELETE FROM assistant_coupon_prompts WHERE user_id = $1::uuid", [
    userId,
  ])
}

/* ------------------------ Paso 1: /tv3<usuario> -c ------------------------ */

/**
 * Ejecuta el paso 1 del canje por chat: valida cliente, alcance, precio,
 * cupón habilitado y saldo suficiente, y deja el prompt pendiente pidiendo
 * el código. Nunca lanza: todo fallo degrada a un mensaje amable.
 */
export async function handleRenovarCuponCommand(input: {
  user: AuthUser
  /** Nombre del comando SIN la barra (ej. «tv3baltazar»): es el usuario. */
  name: string
}): Promise<{ text: string }> {
  const userName = input.name.trim()

  const price = licensePriceMxnOrNull()
  if (price === null) {
    return {
      text: "El pago con cupón no está disponible en este momento: el servidor no tiene configurado el precio de la licencia. Avisa al administrador.",
    }
  }
  if (!isCouponQaEnabled()) {
    return {
      text: "El pago con cupón está desactivado en el servidor. Usa la transferencia (`/tv3" + userName + "`) o Mercado Pago desde **Clientes → renovar**.",
    }
  }

  const scope = await resolveClientScope(input.user)
  if (scope.kind === "none") {
    return {
      text: "Tu cuenta no tiene un distribuidor ligado: no puedes comprar renovaciones. Contacta al administrador.",
    }
  }

  let client: Awaited<ReturnType<typeof getFlujoClient>> = null
  try {
    client = await getFlujoClient(userName, {
      timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
    })
  } catch {
    return {
      text: "No pude consultar el panel de FlujoTV en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
    }
  }
  if (!client) {
    return {
      text: `No encontré el cliente **${userName}** en el panel de FlujoTV. Verifica que el comando sea el usuario EXACTO de la licencia (ej. \`/tv3baltazar\`) e inténtalo de nuevo.`,
    }
  }
  if (scope.kind === "distributor") {
    const allowed = await isFlujoClientInScope(client, scope).catch(() => false)
    if (!allowed) {
      return {
        text: `El cliente **${userName}** no pertenece a tu distribuidor: no puedes renovarlo desde tu cuenta.`,
      }
    }
  }

  // Validación de saldo ANTES de pedir el código (la misma cifra que valida
  // createCouponOrder al debitar): sin saldo no hay prompt.
  const saldos = await getSaldosActual(input.user.id).catch(() => null)
  if (saldos === null) {
    return {
      text: "No pude consultar tu saldo en cupones en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
    }
  }
  if (saldos.cupones < price) {
    return {
      text: [
        `**Saldo en cupones insuficiente** para renovar a **${userName}**.`,
        "",
        `- Costo (1 mes): **${money(price)}**`,
        `- Tu saldo en cupones: **${money(saldos.cupones)}**`,
        `- Te faltan: **${money(price - saldos.cupones)}**`,
        "",
        "El cupón debita tu saldo en cupones (la billetera exclusiva para licencias FlujoTV). Abona saldo desde **Abonar saldo** y vuelve a ejecutar el comando.",
      ].join("\n"),
    }
  }

  await upsertCouponPrompt(input.user.id, userName)

  logEvent("asistente.cupon_command", {
    actor: `user:${input.user.username}`,
    user_name: userName,
  })

  const text = [
    `**Renovación de ${userName} con cupón — 1 mes**`,
    "",
    `Cliente encontrado: **${userName}** (${clienteEstadoLinea(client)}).`,
    "",
    `- Importe: **${money(price)}** (debita tu saldo en cupones)`,
    `- Tu saldo en cupones: **${money(saldos.cupones)}** → quedaría **${money(saldos.cupones - price)}**`,
    "",
    "Escribe **SOLO el código del cupón** (ej. `0000`) para confirmar el canje.",
    "",
    "- Para cancelar, escribe **cancelar**.",
    "- El código vence en **10 minutos**; después vuelve a ejecutar `/tv3" + userName + " -c`.",
  ].join("\n")
  return { text }
}

/* ------------------- Paso 2: interceptor del código ----------------------- */

/** Mensaje de éxito (canje nuevo o replay idempotente de la misma intención). */
function textForCouponOrder(input: {
  result: CreatedCouponOrder
  userName: string
  amount: number
}): string {
  const orden = `\`${shortOrderId(input.result.orderId)}\``
  if (input.result.replayed) {
    return [
      `**Este canje ya estaba registrado** para **${input.userName}**.`,
      "",
      `Orden ${orden} por **${money(input.amount)}**: la renovación de 1 mes ya se había disparado con este mismo código. Te llega la notificación (campana y WhatsApp) con el resultado; si quieres el estado más tarde, pregúntame por la orden ${orden}.`,
    ].join("\n")
  }
  return [
    `**Canje aplicado** — renovación de **${input.userName}** (1 mes) en curso.`,
    "",
    `Orden ${orden} por **${money(input.amount)}** pagada con cupón: la renovación se está aplicando en segundo plano y suele tardar unos minutos. Te llega la notificación (campana y WhatsApp) con el resultado; si quieres el estado más tarde, pregúntame por la orden ${orden}.`,
  ].join("\n")
}

async function persistCouponTurns(input: {
  userId: string
  message: string
  reply: string
  channel: AssistantChannel
}): Promise<void> {
  await appendConversationMessage({
    userId: input.userId,
    role: "user",
    content: input.message,
    channel: input.channel,
  })
  await appendConversationMessage({
    userId: input.userId,
    role: "assistant",
    content: input.reply,
    channel: input.channel,
  })
}

/**
 * Interceptor del paso 2 en la ruta del chat (web y WhatsApp). Se llama con
 * cada mensaje que no fue comando; devuelve la respuesta SOLO cuando hay un
 * prompt de canje pendiente y el mensaje lo resuelve:
 *
 *   - Código con forma de cupón → canje con createCouponOrder (mismo
 *     request_id determinista que la herramienta del LLM: un reintento
 *     dentro de la hora devuelve la orden original) y veredicto.
 *     Código inválido → aviso y el prompt SIGUE vivo para reintentar.
 *   - `cancelar` → prompt borrado y confirmación.
 *   - Prompt vencido (10 min) → se borra y se indica re-ejecutar el comando.
 *
 * Cualquier otro texto devuelve null: el turno sigue su curso normal y el
 * prompt conserva su vigencia (el comprador puede chatear en medio).
 */
export async function maybeHandleCouponRedemption(input: {
  user: AuthUser
  message: string
  /** Adjuntos del turno: un código con archivo no es un canje. */
  attachments: readonly AssistantAttachmentMeta[]
  /** Canal de origen de los turnos persistidos. */
  channel: AssistantChannel
}): Promise<string | null> {
  const message = input.message.trim()
  if (input.attachments.length > 0) return null
  const lower = message.toLowerCase()

  // Solo tocar la BD cuando el mensaje PUEDE ser respuesta al prompt: un
  // código con forma de cupón o una cancelación.
  const isCode = COUPON_CODE_SHAPE.test(message)
  const isCancel = CANCEL_WORDS.has(lower)
  if (!isCode && !isCancel) return null

  const prompt = await getCouponPrompt(input.user.id).catch(() => null)
  if (prompt === null) return null

  if (isCancel) {
    await deleteCouponPrompt(input.user.id).catch(() => undefined)
    const reply = `Canje de cupón cancelado para **${prompt.userName}**. No se cobró nada. Cuando quieras, vuelve a ejecutar \`/tv3${prompt.userName} -c\`.`
    await persistCouponTurns({
      userId: input.user.id,
      message,
      reply,
      channel: input.channel,
    })
    return reply
  }

  if (Date.now() - prompt.createdAt.getTime() > PROMPT_TTL_MS) {
    await deleteCouponPrompt(input.user.id).catch(() => undefined)
    const reply = `El tiempo para escribir el código expiró (vence en 10 minutos). No se cobró nada: vuelve a ejecutar \`/tv3${prompt.userName} -c\` y escribe el código enseguida.`
    await persistCouponTurns({
      userId: input.user.id,
      message,
      reply,
      channel: input.channel,
    })
    return reply
  }

  // Canje: createCouponOrder re-valida TODO atómicamente (código habilitado,
  // topes por comprador, guardia anti-doble-renovación, saldo y débito).
  const requestId = assistantRenewalRequestId({
    userId: input.user.id,
    userName: prompt.userName,
    months: 1,
    paquete: false,
  })
  try {
    const result = await createCouponOrder({
      userName: prompt.userName,
      months: 1,
      buyerUserId: input.user.id,
      code: message,
      requestId,
    })
    await deleteCouponPrompt(input.user.id).catch(() => undefined)
    logEvent("asistente.cupon_redeemed", {
      actor: `user:${input.user.username}`,
      order_id: result.orderId,
      user_name: prompt.userName,
      replayed: result.replayed,
    })
    const reply = textForCouponOrder({
      result,
      userName: prompt.userName,
      amount: result.amount,
    })
    await persistCouponTurns({
      userId: input.user.id,
      message,
      reply,
      channel: input.channel,
    })
    return reply
  } catch (error) {
    if (!(error instanceof MercadoPagoError)) {
      logEvent("asistente.cupon_redeem_error", {
        actor: `user:${input.user.username}`,
        user_name: prompt.userName,
        error: error instanceof Error ? error.message : String(error),
      })
      // Infraestructura: el prompt SOBREVIVE (el comprador puede reintentar
      // el código en unos minutos) y el aviso no reporta falso fallo.
      const reply =
        "No pude registrar el canje en este momento. El código sigue pendiente: inténtalo de nuevo en unos minutos (o escribe **cancelar**); si el problema persiste, avisa al administrador."
      await persistCouponTurns({
        userId: input.user.id,
        message,
        reply,
        channel: input.channel,
      })
      return reply
    }
    logEvent("asistente.cupon_redeem_rejected", {
      actor: `user:${input.user.username}`,
      user_name: prompt.userName,
      code: error.code,
    })
    if (error.code === "invalid_coupon") {
      // Código que no es: el prompt sigue vivo para que reescriba el código.
      const reply = [
        `El código **${message}** no es un cupón válido.`,
        "",
        "Escribe de nuevo SOLO el código del cupón (ej. `0000`), o **cancelar** para abortar.",
      ].join("\n")
      await persistCouponTurns({
        userId: input.user.id,
        message,
        reply,
        channel: input.channel,
      })
      return reply
    }
    // Resto de rechazos (topes, saldo, renovación reciente, cupón
    // desactivado): terminales para esta intención — prompt borrado con el
    // motivo y la vía para reintentar cuando corresponda.
    await deleteCouponPrompt(input.user.id).catch(() => undefined)
    const retry = `/tv3${prompt.userName} -c`
    const extra =
      error.code === "saldo_insuficiente"
        ? " Abona saldo en cupones desde **Abonar saldo** y vuelve a ejecutar el comando."
        : error.code === "coupon_limit" || error.code === "coupon_monthly_limit"
          ? " Vuelve a ejecutar el comando cuando se renueve tu ventana de canjes."
          : ""
    const reply = [
      `**No se pudo canjear el cupón** para **${prompt.userName}**:`,
      "",
      error.message,
      "",
      `No se cobró nada. Cuando puedas reintentar, ejecuta de nuevo \`${retry}\`.${extra}`,
    ].join("\n")
    await persistCouponTurns({
      userId: input.user.id,
      message,
      reply,
      channel: input.channel,
    })
    return reply
  }
}
