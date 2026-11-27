import {
  calcularLinea,
  totalDeLineas,
  type NotaDigitalItemInput,
  type NotaDigitalLinea,
} from "@/lib/nota-digital"
import { PAYMENT_ORDER_MAX_MXN, PAYMENT_ORDER_MIN_MXN } from "@/lib/links-pago"
import { pool, withTransaction, type PoolClientLike } from "@/server/db"
import { AppError } from "@/server/umejson/types"

import {
  checkRateLimitPaymentOrderCreation,
  generateCode,
  getPaymentOrder,
  isUniqueViolation,
  mapRow,
  MAX_PENDING_PAYMENT_ORDERS,
  notifyPaymentOrderChange,
  SELECT_NOTA_COLUMNS,
  type PaymentOrder,
} from "@/server/links-pago/repository"

/*
 * Repositorio de la NOTA DIGITAL. Reutiliza `payment_orders` (mismo ciclo de
 * código, shortener, binding, verificación de depósito, campana y realtime)
 * y agrega SOLO la tabla hija de renglones congelados.
 *
 * ANTI-MANIPULACIÓN: el cliente envía { articuloId, cantidad }; los precios,
 * SKU y nombres se re-LEEN de `articulos` DENTRO de la transacción (bajo RLS
 * del tenant) y se congelan en `nota_digital_items`. Un id ajeno, archivado
 * o no disponible aborta la comanda sin crear nada.
 */

/** Renglón congelado tal como viaja en el jsonb del listado. */
function lineaDeRow(row: Record<string, unknown>): NotaDigitalLinea {
  return {
    sku: String(row.sku ?? ""),
    nombre: String(row.nombre ?? ""),
    um: String(row.um ?? ""),
    precioUnitario: Number(row.precio_unitario ?? 0),
    cantidad: Number(row.cantidad ?? 0),
    importeLinea: Number(row.importe_linea ?? 0),
  }
}

/** Renglines de una nota, en el orden en que el tendero los armó. */
export async function itemsDeNota(
  orderId: string
): Promise<NotaDigitalLinea[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT sku, nombre, um, precio_unitario, cantidad, importe_linea
       FROM nota_digital_items
      WHERE payment_order_id = $1::uuid
      ORDER BY posicion ASC`,
    [orderId]
  )
  return result.rows.map(lineaDeRow)
}

/** Comanda con sus renglones desglosados (para la vista). */
export interface NotaOrder {
  order: PaymentOrder
  items: NotaDigitalLinea[]
}

export async function listNotaOrders(input: {
  creatorUserId?: string
  limit?: number
}): Promise<NotaOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 200)
  const params: unknown[] = []
  const p = (valor: unknown): string => `$${params.push(valor)}`
  const where = ["o.origin = 'nota'"]
  if (input.creatorUserId) {
    where.push(`o.creator_user_id = ${p(input.creatorUserId)}::uuid`)
  }
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_NOTA_COLUMNS}
      WHERE ${where.join(" AND ")}
      ORDER BY o.created_at DESC
      LIMIT ${p(capped)}`,
    params
  )
  return result.rows.map((row) => ({
    order: mapRow(row),
    items: Array.isArray(row.nota_items)
      ? (row.nota_items as Record<string, unknown>[]).map(lineaDeRow)
      : [],
  }))
}

/**
 * Inserta la orden 'nota' y sus renglones EN UNA SOLA transacción. Devuelve
 * la orden ya leída; lanza AppError con mensaje listo para la UI.
 */
export async function crearNotaDigital(input: {
  creatorUserId: string
  items: NotaDigitalItemInput[]
  bank: { bank: string; account: string; holder: string }
  clientId?: string | null
}): Promise<PaymentOrder> {
  if (!checkRateLimitPaymentOrderCreation(input.creatorUserId)) {
    throw new AppError(
      429,
      "payment_order_rate_limit",
      "Demasiadas órdenes creadas en un minuto; espera unos segundos e inténtalo de nuevo."
    )
  }
  const activas = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM payment_orders
      WHERE creator_user_id = $1::uuid AND status IN ('pending','verifying')`,
    [input.creatorUserId]
  )
  if ((activas.rows[0]?.n ?? 0) >= MAX_PENDING_PAYMENT_ORDERS) {
    throw new AppError(
      422,
      "payment_order_limit",
      `Tienes ${MAX_PENDING_PAYMENT_ORDERS} cobros pendientes. Resuelve o cancela alguno antes de crear otra nota.`
    )
  }
  if (input.clientId) {
    // Misma guarda que createPaymentOrder: el cliente debe ser del tenant.
    const owned = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM clients c
         JOIN users u ON u.tenant_id = c.tenant_id
        WHERE c.id = $1::uuid AND u.id = $2::uuid AND c.status = 'active'`,
      [input.clientId, input.creatorUserId]
    )
    if ((owned.rows[0]?.n ?? 0) === 0) {
      throw new AppError(
        422,
        "cliente_invalido",
        "El cliente seleccionado no existe o no pertenece a tu negocio."
      )
    }
  }

  const ids = input.items.map((item) => item.articuloId)
  const orderId = await withTransaction(async (client: PoolClientLike) => {
    const articulos = await client.query(
      `SELECT id::text, sku, nombre, um, precio_unitario
         FROM articulos
        WHERE id = ANY($1::uuid[]) AND status = 'active' AND disponible = true`,
      [ids]
    )
    const porId = new Map(
      articulos.rows.map((row) => [String(row.id), row])
    )
    if (porId.size !== ids.length) {
      throw new AppError(
        422,
        "articulo_no_disponible",
        "Uno de los artículos ya no está disponible. Vuelve a cargar la lista e inténtalo de nuevo."
      )
    }

    const lineas: NotaDigitalLinea[] = input.items.map((item) => {
      const row = porId.get(item.articuloId)!
      const precioUnitario = Number(row.precio_unitario)
      return {
        sku: String(row.sku),
        nombre: String(row.nombre),
        um: String(row.um),
        precioUnitario,
        cantidad: item.cantidad,
        importeLinea: calcularLinea(precioUnitario, item.cantidad),
      }
    })
    const total = totalDeLineas(lineas)
    if (!Number.isFinite(total)) {
      throw new AppError(
        422,
        "total_invalido",
        "No se pudo calcular el total de la comanda."
      )
    }
    if (total < PAYMENT_ORDER_MIN_MXN || total > PAYMENT_ORDER_MAX_MXN) {
      throw new AppError(
        422,
        "monto_invalido",
        `El total de la comanda debe estar entre $${PAYMENT_ORDER_MIN_MXN.toFixed(2)} y $${PAYMENT_ORDER_MAX_MXN.toLocaleString("es-MX")} MXN.`
      )
    }

    let lastError: unknown = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateCode()
      await client.query("SAVEPOINT nota_order_insert")
      try {
        const inserted = await client.query(
          `INSERT INTO payment_orders
             (code, creator_user_id, amount_mxn, note, bank_name, bank_account,
              bank_holder, client_id, origin)
           VALUES ($1, $2::uuid, $3, NULL, $4, $5, $6, $7::uuid, 'nota')
           RETURNING id::text`,
          [
            code,
            input.creatorUserId,
            total,
            input.bank.bank,
            input.bank.account,
            input.bank.holder,
            input.clientId ?? null,
          ]
        )
        const id = String(inserted.rows[0].id)
        for (let index = 0; index < lineas.length; index += 1) {
          const linea = lineas[index]
          await client.query(
            `INSERT INTO nota_digital_items
               (payment_order_id, articulo_id, sku, nombre, um,
                precio_unitario, cantidad, importe_linea, posicion)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
            [
              id,
              input.items[index].articuloId,
              linea.sku,
              linea.nombre,
              linea.um,
              linea.precioUnitario,
              linea.cantidad,
              linea.importeLinea,
              index,
            ]
          )
        }
        await client.query("RELEASE SAVEPOINT nota_order_insert")
        return id
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT nota_order_insert")
        await client.query("RELEASE SAVEPOINT nota_order_insert")
        lastError = error
        if (!isUniqueViolation(error)) throw error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("No se pudo generar un código único para la nota digital.")
  })

  notifyPaymentOrderChange(orderId)
  const created = await getPaymentOrder(orderId)
  if (!created) {
    throw new Error("La nota digital no se pudo leer tras crearse.")
  }
  return created
}
