/**
 * Dominio puro de la NOTA DIGITAL (/modulos/nota-digital): comandas armadas
 * desde el catálogo de Alta de Artículos, con renglones congelados y un link
 * de pago spei.link/<CÓDIGO> que al acreditarse envía la nota al pagador por
 * WhatsApp. Sin BD ni React: se prueba con node directo
 * (scripts/test-nota-digital.mjs).
 */

import type { PaymentOrderListItem } from "@/lib/links-pago"

/** Comanda con sus renglones, tal como cruza la frontera RSC → cliente. */
export interface NotaDigitalListItem extends PaymentOrderListItem {
  items: NotaDigitalLinea[]
}

/** Máximo de renglones de una comanda. */
export const NOTA_MAX_RENGLONES = 50

/** Máximo de cantidad por renglón (espejo del CHECK numeric(10,3)). */
export const NOTA_CANTIDAD_MAX = 9999.999

/** Tope del texto de la nota enviada por WhatsApp. */
export const NOTA_TEXTO_MAX = 2500

/** Entrada del carrito: el cliente SOLO envía id + cantidad, nunca precios. */
export interface NotaDigitalItemInput {
  articuloId: string
  cantidad: number
}

/** Renglón ya congelado por el servidor (precio leído del catálogo). */
export interface NotaDigitalLinea {
  sku: string
  nombre: string
  um: string
  precioUnitario: number
  cantidad: number
  importeLinea: number
}

export type ValidacionComanda =
  | { ok: true; items: NotaDigitalItemInput[] }
  | { ok: false; code: string; error: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANTIDAD_RE = /^\d{1,4}(?:\.\d{1,3})?$/

/**
 * Redondeo a centavos sin el error binario de `1.005 * 100 = 100.49999…`.
 * Trampa exponencial: desplaza dos posiciones, redondea el entero y vuelve.
 */
export function redondearCentavos(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN
  const shifted = Number(`${value}e2`)
  if (!Number.isFinite(shifted)) {
    return Math.round((value + Number.EPSILON) * 100) / 100
  }
  const rounded = Number(`${Math.round(shifted)}e-2`)
  return Number.isFinite(rounded) ? rounded : Math.round(value * 100) / 100
}

/** Importe de un renglón: precio × cantidad, redondeado a centavos. */
export function calcularLinea(
  precioUnitario: number,
  cantidad: number
): number {
  if (!Number.isFinite(precioUnitario) || !Number.isFinite(cantidad)) {
    return Number.NaN
  }
  if (precioUnitario < 0 || cantidad <= 0) return Number.NaN
  return redondearCentavos(precioUnitario * cantidad)
}

/**
 * Total de la comanda: SUMA DE LÍNEAS YA REDONDEADAS (lo que ve el
 * comprador), nunca `round(precio × cantidad_total)` — el total debe calzar
 * al centavo con el depósito que confirma la orden.
 */
export function totalDeLineas(lineas: NotaDigitalLinea[]): number {
  const total = lineas.reduce((sum, linea) => sum + linea.importeLinea, 0)
  return redondearCentavos(total)
}

/**
 * Sanitiza y valida el carrito. IGNORA cualquier precio/campo extra que
 * envíe el cliente (anti-manipulación): el servidor re-lee cada artículo por
 * id desde `articulos` y congela ahí sku/nombre/um/precio.
 */
export function validarComanda(raw: unknown): ValidacionComanda {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Solicitud inválida: se esperaba { items: [{ articuloId, cantidad }] }.",
    }
  }
  const data = raw as Record<string, unknown>
  if (!Array.isArray(data.items)) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Solicitud inválida: falta la lista de artículos.",
    }
  }
  if (data.items.length === 0) {
    return {
      ok: false,
      code: "carrito_vacio",
      error: "Agrega al menos un artículo a la comanda.",
    }
  }
  if (data.items.length > NOTA_MAX_RENGLONES) {
    return {
      ok: false,
      code: "demasiados_renglones",
      error: `Una comanda puede tener hasta ${NOTA_MAX_RENGLONES} renglones.`,
    }
  }

  const items: NotaDigitalItemInput[] = []
  let sumaCantidades = 0
  for (const entrada of data.items) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
      return {
        ok: false,
        code: "articulo_invalido",
        error: "Cada renglón debe traer un artículo y una cantidad.",
      }
    }
    const item = entrada as Record<string, unknown>
    if (typeof item.articuloId !== "string" || !UUID_RE.test(item.articuloId)) {
      return {
        ok: false,
        code: "articulo_id_invalido",
        error: "Uno de los artículos no es válido. Vuelve a agregarlo desde la lista.",
      }
    }
    const cantidadBruta = item.cantidad
    const texto =
      typeof cantidadBruta === "number"
        ? String(cantidadBruta)
        : typeof cantidadBruta === "string"
          ? cantidadBruta.trim()
          : ""
    if (!CANTIDAD_RE.test(texto)) {
      return {
        ok: false,
        code: "cantidad_invalida",
        error: "La cantidad debe ser un número mayor a cero con hasta 3 decimales.",
      }
    }
    const cantidad = Number.parseFloat(texto)
    if (
      !Number.isFinite(cantidad) ||
      cantidad <= 0 ||
      cantidad > NOTA_CANTIDAD_MAX
    ) {
      return {
        ok: false,
        code: "cantidad_invalida",
        error: `La cantidad debe estar entre 0 y ${NOTA_CANTIDAD_MAX}.`,
      }
    }
    sumaCantidades += cantidad
    items.push({ articuloId: item.articuloId, cantidad })
  }
  if (!Number.isFinite(sumaCantidades)) {
    return {
      ok: false,
      code: "total_invalido",
      error: "El total de la comanda no es válido.",
    }
  }
  return { ok: true, items }
}

/** Cantidad legible: sin ceros decimales sobrantes (1 → «1», 1.5 → «1.5»). */
export function cantidadTexto(cantidad: number): string {
  return String(Number(cantidad.toFixed(3)))
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Nota Digital enviada al pagador por WhatsApp al confirmarse el depósito.
 * Incluye folio (el código de 4 del link), fecha, negocio, cada renglón
 * desglosado y el TOTAL. Texto determinista y acotado a NOTA_TEXTO_MAX: con
 * muchas líneas se recorta el desglose, pero SIEMPRE se conserva el total.
 */
export function formatearNotaDigital(input: {
  code: string
  fecha: string
  negocio: string
  lineas: NotaDigitalLinea[]
  total: number
}): string {
  const cierre = `Gracias por tu compra. Tu pago quedó confirmado.`
  const totalTexto = `*TOTAL: ${money(input.total)} MXN*`
  const separador = "────────────────────"
  const encabezado = [
    `*Nota Digital — ${input.negocio}*`,
    `Folio: *${input.code}* · ${input.fecha}`,
    "",
  ]
  const pie = ["", separador, totalTexto, "", cierre]

  const renglones = input.lineas.map(
    (linea) =>
      `${cantidadTexto(linea.cantidad)} ${linea.um} × ${
        linea.nombre
      } — ${money(linea.precioUnitario)} c/u — ${money(linea.importeLinea)}`
  )

  const completo = [...encabezado, ...renglones, ...pie].join("\n")
  if (completo.length <= NOTA_TEXTO_MAX) return completo

  // Recorta el desglose por el final; el encabezado y el pie (con el total)
  // nunca se tocan. El aviso deja claro que faltaron renglones.
  const reservado =
    encabezado.join("\n").length + pie.join("\n").length + 80
  const permitido = Math.max(0, NOTA_TEXTO_MAX - reservado)
  const conservados: string[] = []
  let usado = 0
  for (const renglon of renglones) {
    const extra = conservados.length === 0 ? renglon.length : renglon.length + 1
    if (usado + extra > permitido) break
    conservados.push(renglon)
    usado += extra
  }
  const omitidos = input.lineas.length - conservados.length
  const aviso =
    omitidos > 0 ? [`… y ${omitidos} renglón(es) más.`] : []
  return [...encabezado, ...conservados, ...aviso, ...pie]
    .join("\n")
    .slice(0, NOTA_TEXTO_MAX)
}
