"use server"

import { isOwnerRole } from "@/server/auth/types"
import { revalidatePath } from "next/cache"
import QRCode from "qrcode"

import { requireUser } from "@/server/auth/guards"
import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { resolveCreatorBankData } from "@/server/links-pago/bank"
import {
  normalizePaymentOrderConcepto,
  paymentOrderConceptAnchor,
  PAYMENT_ORDER_CONCEPTO_ERROR,
} from "@/lib/links-pago"
import {
  cancelPaymentOrder,
  checkRateLimitPaymentOrderCreation,
  createPaymentOrder,
  getPaymentOrder,
  PAYMENT_ORDER_MAX_MXN,
  PAYMENT_ORDER_MIN_MXN,
  resolvePaymentOrder,
} from "@/server/links-pago/repository"
import { buildPaymentOrderShortLink, buildPaymentOrderWaLink } from "@/server/links-pago/wa-link"

import type { PaymentOrder } from "@/server/links-pago/repository"

/*
 * Acciones del módulo SPEILink (/modulos/links-de-pago). Contrato de
 * estado del repo (patrón profile.ts): NUNCA lanzan hacia el cliente —
 * devuelven `{ error }` con el mensaje listo para pintar junto al campo.
 */

export interface CreatedPaymentOrder {
  orderId: string
  code: string
  amountMxn: number
  note: string | null
  bank: { bank: string; account: string; holder: string }
  /** Link corto spei.link/<código>: lo que se comparte y codifica el QR. */
  shortUrl: string
  /** Link wa.me con la solicitud prellenada: destino del shortener. */
  waUrl: string
  qrDataUrl: string
}

export interface CreatePaymentOrderResult {
  error: string | null
  order: CreatedPaymentOrder | null
}

/**
 * Crea la orden 'pending' y devuelve el link corto (QR incluido) para
 * pintar en el diálogo: el cobrador escanea desde su celular o comparte el
 * link.
 */
export async function createPaymentOrderAction(input: {
  amountMxn: number
  /** Concepto de pago: UNA palabra alfanumérica (obligatorio). */
  note: string
}): Promise<CreatePaymentOrderResult> {
  const user = await requireUser("core")

  const amount = Number(input.amountMxn)
  if (!Number.isFinite(amount) || amount < PAYMENT_ORDER_MIN_MXN) {
    return { error: `El monto mínimo es $${PAYMENT_ORDER_MIN_MXN.toFixed(2)} MXN`, order: null }
  }
  if (amount > PAYMENT_ORDER_MAX_MXN) {
    return { error: `El monto máximo es $${PAYMENT_ORDER_MAX_MXN.toLocaleString("es-MX")} MXN`, order: null }
  }

  // El concepto de pago es el ANCLA de conciliación: el pagador lo recibe
  // por WhatsApp, lo escribe en su SPEI y el escaneo valida el comprobante
  // contra esta palabra (el código del link queda como identificador).
  const note = normalizePaymentOrderConcepto(input.note ?? "")
  if (!note) {
    return { error: PAYMENT_ORDER_CONCEPTO_ERROR, order: null }
  }

  const bank = await resolveCreatorBankData(user)
  if (!bank) {
    return {
      error:
        isOwnerRole(user.role)
          ? "Faltan los datos bancarios para recibir el pago: complétalos en Perfil → Datos bancarios o configura TRANSFER_BANK_NAME/ACCOUNT/HOLDER en el servidor."
          : "Faltan tus datos bancarios para recibir el pago: complétalos en Perfil → Datos bancarios (Banco, Destinatario y CLABE).",
      order: null,
    }
  }

  if (!checkRateLimitPaymentOrderCreation(user.id)) {
    return {
      error: "Demasiadas órdenes creadas en un minuto; espera unos segundos e inténtalo de nuevo.",
      order: null,
    }
  }

  try {
    const created = await createPaymentOrder({
      creatorUserId: user.id,
      amountMxn: amount,
      note,
      bank,
    })

    const waUrl = buildPaymentOrderWaLink(created.amountMxn)
    if (!waUrl) {
      // El canal WhatsApp es la vía de entrega y cobro del módulo: sin
      // número del agente la orden no sirve — se revierte y se explica.
      await cancelPaymentOrder({ orderId: created.id, reviewedBy: user.id })
      return {
        error: "El canal de WhatsApp no está configurado en el servidor (WHATSAPP_AGENT_NUMBER): no hay chat al que apuntar el link de pago.",
        order: null,
      }
    }

    // El QR codifica el link CORTO (se identifica con el código de
    // concepto); el botón de apertura usa wa.me directo (un salto menos).
    const shortUrl = buildPaymentOrderShortLink(created.code)
    const qrDataUrl = await QRCode.toDataURL(shortUrl, { margin: 1, width: 320 })

    revalidatePath("/modulos/links-de-pago")
    return {
      error: null,
      order: {
        orderId: created.id,
        code: created.code,
        amountMxn: created.amountMxn,
        note: created.note,
        bank: created.bank,
        shortUrl,
        waUrl,
        qrDataUrl,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo crear el link de pago."
    return { error: message, order: null }
  }
}

export interface PaymentOrderLinkResult {
  error: string | null
  order: CreatedPaymentOrder | null
}

/**
 * Vuelve a armar el diálogo de creación (link corto + QR + datos SPEI)
 * para una orden ACTIVA ya existente (creador o admin): mismo contenido
 * que cuando se creó, sin tocar la orden. Las resueltas no se comparten.
 */
export async function getPaymentOrderLinkAction(input: {
  orderId: string
}): Promise<PaymentOrderLinkResult> {
  const user = await requireUser("core")

  const order = await getPaymentOrder(input.orderId).catch(() => null)
  if (!order) return { error: "El link de pago no existe.", order: null }
  if (!isOwnerRole(user.role) && order.creatorUserId !== user.id) {
    return { error: "Solo el creador del link o un administrador puede verla.", order: null }
  }
  if (order.status !== "pending" && order.status !== "verifying") {
    return { error: "El link ya está resuelto.", order: null }
  }

  const waUrl = buildPaymentOrderWaLink(order.amountMxn)
  if (!waUrl) {
    return {
      error: "El canal de WhatsApp no está configurado en el servidor (WHATSAPP_AGENT_NUMBER): no hay chat al que apuntar el link de pago.",
      order: null,
    }
  }

  const shortUrl = buildPaymentOrderShortLink(order.code)
  const qrDataUrl = await QRCode.toDataURL(shortUrl, { margin: 1, width: 320 })

  return {
    error: null,
    order: {
      orderId: order.id,
      code: order.code,
      amountMxn: order.amountMxn,
      note: order.note,
      bank: order.bank,
      shortUrl,
      waUrl,
      qrDataUrl,
    },
  }
}

export interface ResolvePaymentOrderResult {
  error: string | null
}

/** Confirmación DIRECTA al pagador por la cola de WhatsApp (con reintentos). */
function notifyPayerOfResolution(
  order: PaymentOrder,
  title: string,
  body: string
): void {
  if (!order.payerPhone) return
  void enqueueWhatsAppForPhone({
    userId: order.creatorUserId,
    phone: order.payerPhone,
    kind: WHATSAPP_KIND_PAYMENT_ORDER,
    title,
    body,
  })
}

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

/**
 * Resuelve una orden ACTIVA desde la UI (creador o admin): aprobar marca el
 * cobro como pagado y avisa al pagador; rechazar pide motivo y avisa a
 * ambos. Funciona desde 'pending' Y desde 'verifying' (el override manual
 * del creador no espera la confirmación del depósito: la verificación es
 * red de seguridad, no jaula). El claim atómico evita dobles resoluciones.
 */
export async function resolvePaymentOrderAction(input: {
  orderId: string
  decision: "approve" | "reject"
  reason?: string
}): Promise<ResolvePaymentOrderResult> {
  const user = await requireUser("core")

  const order = await getPaymentOrder(input.orderId).catch(() => null)
  if (!order) return { error: "El link de pago no existe." }
  if (!isOwnerRole(user.role) && order.creatorUserId !== user.id) {
    return { error: "Solo el creador del link o un administrador puede resolverla." }
  }
  if (order.status !== "pending" && order.status !== "verifying") {
    return { error: "El link ya está resuelto." }
  }

  const reason = (input.reason ?? "").trim().slice(0, 300) || null

  const resolved =
    input.decision === "approve"
      ? await resolvePaymentOrder({
          orderId: order.id,
          decision: "paid",
          reviewedBy: user.id,
        }).catch(() => null)
      : await resolvePaymentOrder({
          orderId: order.id,
          decision: "rejected",
          reviewedBy: user.id,
          rejectionReason: reason,
        }).catch(() => null)
  if (!resolved) {
    return { error: "Otro usuario acaba de resolver este link." }
  }

  if (input.decision === "approve") {
    notifyPayerOfResolution(
      resolved,
      "Pago confirmado",
      `Confirmamos tu pago de ${money(resolved.amountMxn)} con el concepto de pago ${paymentOrderConceptAnchor(resolved)}. Gracias.`
    )
    if (user.id !== resolved.creatorUserId) {
      createPaymentOrderNotification({
        userId: resolved.creatorUserId,
        orderId: resolved.id,
        title: "Cobro recibido",
        body: `Tu link de pago ${resolved.code} (${money(resolved.amountMxn)}) fue marcada como pagada por el administrador.`,
      })
    }
  } else {
    notifyPayerOfResolution(
      resolved,
      "Pago no confirmado",
      `El comprobante con el concepto de pago ${paymentOrderConceptAnchor(resolved)} no fue aceptado${
        reason ? `: ${reason}` : ""
      }. Contacta a quien te emitió el link.`
    )
    if (user.id !== resolved.creatorUserId) {
      createPaymentOrderNotification({
        userId: resolved.creatorUserId,
        orderId: resolved.id,
        title: "Link de pago rechazado",
        body: `El administrador rechazó tu link de pago ${resolved.code} (${money(resolved.amountMxn)})${
          reason ? `: ${reason}` : "."
        }`,
      })
    }
  }

  revalidatePath("/modulos/links-de-pago")
  return { error: null }
}

/**
 * Cancela una orden activa (creador o admin, pendiente o en verificación):
 * el código queda libre y la orden queda 'cancelled' para la bitácora. Sin
 * pago en vuelo asumible.
 */
export async function cancelPaymentOrderAction(input: {
  orderId: string
}): Promise<ResolvePaymentOrderResult> {
  const user = await requireUser("core")

  const order = await getPaymentOrder(input.orderId).catch(() => null)
  if (!order) return { error: "El link de pago no existe." }
  if (!isOwnerRole(user.role) && order.creatorUserId !== user.id) {
    return { error: "Solo el creador del link o un administrador puede cancelarla." }
  }
  if (order.status !== "pending" && order.status !== "verifying") {
    return { error: "El link ya está resuelto." }
  }

  const cancelled = await cancelPaymentOrder({
    orderId: order.id,
    reviewedBy: user.id,
  }).catch(() => null)
  if (!cancelled) {
    return { error: "Otro usuario acaba de resolver este link." }
  }

  revalidatePath("/modulos/links-de-pago")
  return { error: null }
}
