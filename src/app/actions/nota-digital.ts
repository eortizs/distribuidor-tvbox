"use server"

import QRCode from "qrcode"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/server/auth/guards"
import { resolveCreatorBankData } from "@/server/links-pago/bank"
import {
  buildPaymentOrderShortLink,
  buildPaymentOrderWaLink,
  resolvePaymentOrderWhatsAppNumber,
} from "@/server/links-pago/wa-link"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import {
  type PaymentOrder,
} from "@/server/links-pago/repository"
import { crearNotaDigital } from "@/server/nota-digital/repository"
import { validarComanda } from "@/lib/nota-digital"
import type {
  CreatedPaymentOrder,
  CreatePaymentOrderResult,
} from "@/app/actions/links-pago"

/*
 * Acción de la NOTA DIGITAL (/modulos/nota-digital). Contrato idéntico al
 * de SPEILink: NUNCA lanza hacia el cliente — devuelve `{ error, order }`.
 * La orden se crea con `origin='nota'`, `note=null` y los renglones se
 * congelan en el servidor desde `articulos` (anti-manipulación de precios).
 */

/**
 * Crea la comanda y devuelve el link corto / QR para el diálogo compartido
 * `LinkCreadoDialog` (se reutiliza tal cual).
 */
export async function createNotaDigitalAction(input: {
  items: { articuloId: string; cantidad: number }[]
}): Promise<CreatePaymentOrderResult> {
  const user = await requireUser("core")

  const validacion = validarComanda(input)
  if (!validacion.ok) {
    return { error: validacion.error, order: null }
  }

  const bank = await resolveCreatorBankData(user)
  if (!bank) {
    return {
      error:
        user.tenantId && user.tenantId !== LEGACY_TENANT_ID
          ? "Faltan los datos bancarios del negocio para recibir el pago: complétalos en Perfil → Datos del negocio."
          : "Faltan los datos bancarios para recibir el pago: complétalos en Perfil → Datos bancarios o configura TRANSFER_BANK_NAME/ACCOUNT/HOLDER en el servidor.",
      order: null,
    }
  }

  // El canal WhatsApp es la vía de entrega: se resuelve ANTES de crear la
  // orden (error claro, sin crear y cancelar).
  const waNumber = await resolvePaymentOrderWhatsAppNumber(user.tenantId ?? null)
  if (!waNumber) {
    return {
      error:
        user.tenantId && user.tenantId !== LEGACY_TENANT_ID
          ? "Vincula el WhatsApp de tu negocio en Módulos → WhatsApp antes de crear notas digitales."
          : "El canal de WhatsApp no está configurado en el servidor (WHATSAPP_AGENT_NUMBER): no hay chat al que apuntar el link de pago.",
      order: null,
    }
  }

  try {
    const created = await crearNotaDigital({
      creatorUserId: user.id,
      items: validacion.items,
      bank,
    })

    const shortUrl = buildPaymentOrderShortLink(created.code)
    const waUrl = buildPaymentOrderWaLink({
      amountMxn: created.amountMxn,
      code: created.code,
      number: waNumber,
      origin: "nota",
    })
    const qrDataUrl = await QRCode.toDataURL(shortUrl, { margin: 1, width: 320 })

    revalidatePath("/modulos/nota-digital")
    return {
      error: null,
      order: createdPaymentOrder(created, shortUrl, waUrl, qrDataUrl),
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo crear la nota digital.",
      order: null,
    }
  }
}

function createdPaymentOrder(
  created: PaymentOrder,
  shortUrl: string,
  waUrl: string,
  qrDataUrl: string
): CreatedPaymentOrder {
  return {
    orderId: created.id,
    code: created.code,
    amountMxn: created.amountMxn,
    note: created.note,
    bank: created.bank,
    shortUrl,
    waUrl,
    qrDataUrl,
  }
}
