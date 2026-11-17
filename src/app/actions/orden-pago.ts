"use server"

import { revalidatePath } from "next/cache"
import QRCode from "qrcode"

import { requireUser } from "@/server/auth/guards"
import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { resolveCreatorBankData } from "@/server/orden-pago/bank"
import {
  cancelPaymentOrder,
  checkRateLimitPaymentOrderCreation,
  createPaymentOrder,
  getPaymentOrder,
  PAYMENT_ORDER_MAX_MXN,
  PAYMENT_ORDER_MIN_MXN,
  resolvePaymentOrder,
} from "@/server/orden-pago/repository"
import { buildPaymentOrderWaLink } from "@/server/orden-pago/wa-link"

import type { PaymentOrder } from "@/server/orden-pago/repository"

/*
 * Acciones del módulo Orden de pago (/modulos/orden-de-pago). Contrato de
 * estado del repo (patrón profile.ts): NUNCA lanzan hacia el cliente —
 * devuelven `{ error }` con el mensaje listo para pintar junto al campo.
 */

export interface CreatedPaymentOrder {
  orderId: string
  code: string
  amountMxn: number
  note: string | null
  bank: { bank: string; account: string; holder: string }
  waUrl: string
  qrDataUrl: string
}

export interface CreatePaymentOrderResult {
  error: string | null
  order: CreatedPaymentOrder | null
}

/**
 * Crea la orden 'pending' y devuelve la liga wa.me + el QR para pintar en el
 * diálogo: el cobrador escanea desde su celular o comparte la liga.
 */
export async function createPaymentOrderAction(input: {
  amountMxn: number
  note?: string
}): Promise<CreatePaymentOrderResult> {
  const user = await requireUser()

  const amount = Number(input.amountMxn)
  if (!Number.isFinite(amount) || amount < PAYMENT_ORDER_MIN_MXN) {
    return { error: `El monto mínimo es $${PAYMENT_ORDER_MIN_MXN.toFixed(2)} MXN`, order: null }
  }
  if (amount > PAYMENT_ORDER_MAX_MXN) {
    return { error: `El monto máximo es $${PAYMENT_ORDER_MAX_MXN.toLocaleString("es-MX")} MXN`, order: null }
  }

  const note = (input.note ?? "").trim().slice(0, 120) || null

  const bank = await resolveCreatorBankData(user)
  if (!bank) {
    return {
      error:
        user.role === "admin"
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

    const waUrl = buildPaymentOrderWaLink(created.code)
    if (!waUrl) {
      // El canal WhatsApp es la vía de entrega y cobro del módulo: sin
      // número del agente la orden no sirve — se revierte y se explica.
      await cancelPaymentOrder({ orderId: created.id, reviewedBy: user.id })
      return {
        error: "El canal de WhatsApp no está configurado en el servidor (WHATSAPP_AGENT_NUMBER): no hay chat al que apuntar la orden de pago.",
        order: null,
      }
    }

    const qrDataUrl = await QRCode.toDataURL(waUrl, { margin: 1, width: 320 })

    revalidatePath("/modulos/orden-de-pago")
    return {
      error: null,
      order: {
        orderId: created.id,
        code: created.code,
        amountMxn: created.amountMxn,
        note: created.note,
        bank: created.bank,
        waUrl,
        qrDataUrl,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo crear la orden de pago."
    return { error: message, order: null }
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
 * Resuelve una orden pendiente desde la UI (creador o admin): aprobar
 * marca el cobro como pagado y avisa al pagador; rechazar pide motivo y
 * avisa a ambos. El claim atómico evita dobles resoluciones.
 */
export async function resolvePaymentOrderAction(input: {
  orderId: string
  decision: "approve" | "reject"
  reason?: string
}): Promise<ResolvePaymentOrderResult> {
  const user = await requireUser()

  const order = await getPaymentOrder(input.orderId).catch(() => null)
  if (!order) return { error: "La orden de pago no existe." }
  if (user.role !== "admin" && order.creatorUserId !== user.id) {
    return { error: "Solo el creador de la orden o un administrador puede resolverla." }
  }
  if (order.status !== "pending") {
    return { error: "La orden ya está resuelta." }
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
    return { error: "Otro usuario acaba de resolver esta orden." }
  }

  if (input.decision === "approve") {
    notifyPayerOfResolution(
      resolved,
      "Pago confirmado",
      `Confirmamos tu pago de ${money(resolved.amountMxn)} con el código ${resolved.code}. Gracias.`
    )
    if (user.id !== resolved.creatorUserId) {
      createPaymentOrderNotification({
        userId: resolved.creatorUserId,
        orderId: resolved.id,
        title: "Cobro recibido",
        body: `Tu orden de pago ${resolved.code} (${money(resolved.amountMxn)}) fue marcada como pagada por el administrador.`,
      })
    }
  } else {
    notifyPayerOfResolution(
      resolved,
      "Pago no confirmado",
      `El comprobante del código ${resolved.code} no fue aceptado${
        reason ? `: ${reason}` : ""
      }. Contacta a quien te emitió la orden.`
    )
    if (user.id !== resolved.creatorUserId) {
      createPaymentOrderNotification({
        userId: resolved.creatorUserId,
        orderId: resolved.id,
        title: "Orden de pago rechazada",
        body: `El administrador rechazó tu orden de pago ${resolved.code} (${money(resolved.amountMxn)})${
          reason ? `: ${reason}` : "."
        }`,
      })
    }
  }

  revalidatePath("/modulos/orden-de-pago")
  return { error: null }
}

/**
 * Cancela una orden pendiente (creador o admin): el código queda libre y la
 * orden queda 'cancelled' para la bitácora. Sin pago en vuelo asumible.
 */
export async function cancelPaymentOrderAction(input: {
  orderId: string
}): Promise<ResolvePaymentOrderResult> {
  const user = await requireUser()

  const order = await getPaymentOrder(input.orderId).catch(() => null)
  if (!order) return { error: "La orden de pago no existe." }
  if (user.role !== "admin" && order.creatorUserId !== user.id) {
    return { error: "Solo el creador de la orden o un administrador puede cancelarla." }
  }
  if (order.status !== "pending") {
    return { error: "La orden ya está resuelta." }
  }

  const cancelled = await cancelPaymentOrder({
    orderId: order.id,
    reviewedBy: user.id,
  }).catch(() => null)
  if (!cancelled) {
    return { error: "Otro usuario acaba de resolver esta orden." }
  }

  revalidatePath("/modulos/orden-de-pago")
  return { error: null }
}
