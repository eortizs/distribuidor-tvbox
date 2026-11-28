import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { runWithTenant } from "@/server/tenant/context"
import { paymentOrderConceptoVisible } from "@/lib/links-pago"
import { formatearNotaDigital } from "@/lib/nota-digital"
import { itemsDeNota } from "@/server/nota-digital/repository"
import { pool } from "@/server/db"
import { generarTicketImagen } from "@/server/tickets/ticket-imagen"

import type { NotaDigitalLinea } from "@/lib/nota-digital"
import type { PaymentOrder } from "./repository"

/*
 * Avisos de DEPÓSITO CONFIRMADO de una orden de pago: campana al creador
 * (con espejo WhatsApp) + WhatsApp directo al pagador si su teléfono está
 * ligado. Viven en un módulo propio (sin depender del flujo de revisión del
 * comprobante) para que TODOS los confirmadores los compartan sin ciclos de
 * importación: el chequeo inmediato y el verificador en background
 * (deposit-verifier.ts) y la rama webhook de depósitos (mercadopago/
 * service.ts → deposit-check.ts). Toda confirmación lleva comprobante
 * validado por IMPORTE y depósito acreditado (el concepto de pago es libre).
 *
 * NOTA DIGITAL (módulo Pedidos): al confirmarse, el WhatsApp al pagador es
 * el TICKET DE COMPRA como IMAGEN PNG (diseño FlujoTV, src/server/tickets/)
 * con caption de confirmación. Si la generación de la imagen falla (sin
 * Chrome, red, disco), degrada al TEXTO de la nota desglosada de siempre —
 * el pagador nunca se queda sin aviso. El tendero conserva su campana
 * «cobro confirmado»; no se le reenvía la nota.
 */

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

/** Fecha legible de la nota, en hora de México (determinista). */
function fechaNota(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))
}

/** Texto de la Nota Digital desglosada de una orden ya pagada. */
export async function notaDigitalTexto(order: PaymentOrder): Promise<string> {
  const lineas = await itemsDeNota(order.id).catch(() => [])
  return formatearNotaDigital({
    code: order.code,
    fecha: fechaNota(order.resolvedAt ?? order.createdAt),
    negocio: order.creatorUsername?.trim() || "tu negocio",
    lineas,
    total: order.amountMxn,
  })
}

/** Fecha del ticket, solo día, en hora de México (determinista). */
function fechaTicket(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso))
}

/** Hora del ticket, en hora de México (determinista). */
function horaTicket(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

/** Nombre del CLIENTE para el ticket: cliente ligado a la orden (registry
 * local del negocio), si no el nombre de perfil del pagador, si no genérico. */
async function clienteDelTicket(order: PaymentOrder): Promise<string> {
  if (order.clientId) {
    const result = await pool
      .query<{ name: string }>(
        `SELECT name FROM clients WHERE id = $1::uuid`,
        [order.clientId]
      )
      .catch(() => ({ rows: [] as { name: string }[] }))
    const nombre = result.rows[0]?.name?.trim()
    if (nombre) return nombre
  }
  return order.payerName?.trim() || "Cliente"
}

/** Concepto del ticket a partir de los renglones congelados de la comanda. */
function conceptoDelTicket(lineas: NotaDigitalLinea[]): string {
  if (lineas.length === 0) return "Compra"
  if (lineas.length === 1) return lineas[0].nombre || "Compra"
  return `${lineas.length} artículos`
}

/** Datos del ticket de compra de una orden 'nota' ya pagada. */
async function datosTicketCompra(
  order: PaymentOrder,
  lineas: NotaDigitalLinea[]
): Promise<Parameters<typeof generarTicketImagen>[0]> {
  const instante = order.resolvedAt ?? order.createdAt
  return {
    titulo: "Ticket de compra",
    subtitulo: "Gracias por seguir con nosotros",
    fecha: fechaTicket(instante),
    hora: horaTicket(instante),
    folio: order.code,
    cliente: await clienteDelTicket(order),
    concepto: conceptoDelTicket(lineas),
    metodoPago: "Transferencia",
    estado: "Pagado",
    total: order.amountMxn.toFixed(2),
    moneda: "MXN",
    etiquetaTotal: "Total",
    tagline: order.creatorUsername?.trim() || "SPEILink",
    gracias: "¡Gracias por tu compra!",
    equipo: "SPEILink",
  }
}

/**
 * Entrega al pagador el TICKET DE COMPRA como IMAGEN PNG por WhatsApp (la
 * imagen se ve con el branding de inmediato en el chat; un PDF solo muestra
 * un icono) con caption de confirmación. Es la vía ÚNICA de los dos
 * confirmadores de una orden del módulo Pedidos: la confirmación automática
 * por depósito (`notifyDepositConfirmedInTenant`) y la aprobación manual del
 * creador (`resolvePaymentOrderAction`, fire-and-forget para no frenar la
 * UI). Nunca lanza: si la imagen no se puede generar, encola el TEXTO de la
 * nota desglosada de siempre.
 */
export async function entregarTicketCompraAlPagador(
  order: PaymentOrder
): Promise<void> {
  if (!order.payerPhone) return
  const lineas = await itemsDeNota(order.id).catch(() => [])
  try {
    const imagen = await generarTicketImagen(
      await datosTicketCompra(order, lineas),
      // El archivo en disco se nombra por el ID (inmutable): el CÓDIGO de la
      // orden es reciclable (único solo entre activas) y una orden nueva que
      // lo re-acuñe sobrescribiría la imagen aún referenciada por una fila de
      // cola pendiente — el pagador viejo recibiría el ticket equivocado.
      `ticket-${order.id}`
    )
    enqueueWhatsAppForPhone({
      userId: order.creatorUserId,
      phone: order.payerPhone,
      kind: WHATSAPP_KIND_PAYMENT_ORDER,
      // El caption es SOLO el nombre del documento: la imagen ya trae toda
      // la información (folio, cliente, total, estado) y el texto adicional
      // sería redundancia en el chat.
      title: "Ticket de compra",
      body: "",
      attachment: {
        path: imagen.filePath,
        name: `Ticket ${order.code}.webp`,
        mime: imagen.mime,
      },
    })
    return
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `tickets: ticket_imagen_fallback_texto ${order.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
  notifyPayer(order, "Tu Nota Digital", await notaDigitalTexto(order))
}

/** Aviso al creador por campana (con espejo WhatsApp); nunca lanza. */
export function notifyCreator(
  order: PaymentOrder,
  title: string,
  body: string
): void {
  createPaymentOrderNotification({
    userId: order.creatorUserId,
    orderId: order.id,
    title,
    body,
  })
}

/** Confirmación DIRECTA al pagador por WhatsApp; nunca lanza. */
function notifyPayer(
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

/**
 * El pagador contactó (primer binding de su teléfono: recibió el código y
 * la CLABE por WhatsApp). Campana SOLO al creador — el pagador ya está en
 * el chat y su confirmación fluye por ahí. Se dispara UNA vez por orden
 * (`touchPaymentOrderPayer` devuelve true solo en el primer binding).
 */
export function notifyPayerContacted(order: PaymentOrder, phone: string): void {
  const entrega =
    order.origin === "nota"
      ? `abrió tu nota digital ${order.code} (${money(
          order.amountMxn
        )}) y recibió el importe y la CLABE.`
      : `abrió tu link ${order.code} (${money(
          order.amountMxn
        )}) y recibió el concepto de pago ${paymentOrderConceptoVisible(order)} y la CLABE.`
  notifyCreator(
    order,
    "Pagador en contacto",
    `El pagador (WhatsApp ${maskPhone(phone)}) ${entrega} Te avisaremos cuando envíe su comprobante o cuando el pago se confirme.`
  )
}

/**
 * Depósito confirmado CON comprobante validado (chequeo inmediato del
 * turno, verificador del carril 'verifying' y barrido/webhook — toda
 * confirmación pasa por el comprobante): los textos lo mencionan.
 *
 * El aviso corre bajo el tenant de la ORDEN (§4.5 2A): desde el barrido
 * cross-tenant llega bajo `runAsPlatform`, donde el GUC de tenant no existe
 * — el trigger dejaría `tenant_id` NULL y los INSERTs en `notifications`/
 * `wa_outbox` fallarían en silencio.
 */
export function notifyDepositConfirmed(order: PaymentOrder): void {
  void runWithTenant(order.tenantId, async () => {
    await notifyDepositConfirmedInTenant(order)
  }).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `links_pago: notify_deposit_confirmed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  })
}

async function notifyDepositConfirmedInTenant(
  order: PaymentOrder
): Promise<void> {
  const pagador = order.payerPhone ? ` (WhatsApp ${maskPhone(order.payerPhone)})` : ""
  const deposito = order.mpDepositAt
    ? ` acreditado el ${new Date(order.mpDepositAt).toLocaleString("es-MX")}`
    : ""
  notifyCreator(
    order,
    "Cobro confirmado por depósito",
    order.origin === "nota"
      ? `El pagador${pagador} pagó tu nota digital ${order.code} (${money(
          order.amountMxn
        )}): el comprobante pasó la validación por importe y el depósito quedó acreditado en tu cuenta${deposito}.`
      : `El pagador${pagador} de tu orden ${order.code} pagó ${money(
          order.amountMxn
        )}: el comprobante pasó la validación automática (importe) y el depósito quedó acreditado en tu cuenta${deposito}.`
  )

  if (order.origin === "nota") {
    await entregarTicketCompraAlPagador(order)
    return
  }

  notifyPayer(
    order,
    "Pago confirmado",
    `Recibimos tu comprobante y confirmamos el depósito de ${money(
      order.amountMxn
    )} en la cuenta. Tu pago quedó validado. Gracias.`
  )
}
