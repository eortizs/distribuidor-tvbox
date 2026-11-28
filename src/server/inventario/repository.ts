import {
  INVENTARIO_CANTIDAD_MAX,
  INVENTARIO_DIAS_POR_VENCER,
  INVENTARIO_MAX_LOTES_POR_TENANT,
  esUuidValido,
  hoyIsoCdmx,
  loteDeRow,
  movimientoDeRow,
  type LoteInventario,
  type LoteInput,
  type LoteMetaInput,
  type MovimientoInventario,
  type MovimientoInput,
  type ResumenInventario,
} from "@/lib/inventario"
import { esArticuloIdValido, patronBusqueda } from "@/lib/articulos"
import { pool, withTransaction } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Repositorio del Inventario. El alcance es el TENANT completo (propietario
 * y sucursales comparten las existencias): el aislamiento lo hace RLS — el
 * pool fija app.tenant_id por consulta y toda fila ajena es invisible, así
 * que un id ajeno o inexistente responde 404, no 403, para no revelar
 * existencia. NADA se borra (DELETE revocado en ambas tablas): un lote se
 * agota con un movimiento y una corrección del kardex es un movimiento
 * `ajuste`.
 *
 * El stock NUNCA se edita directo: cada cambio corre en UNA transacción que
 * bloquea la fila del lote (SELECT … FOR UPDATE), inserta el movimiento y
 * actualiza el balance con cantidad_antes/despues — el CHECK de balance de
 * la tabla garantiza que la bitácora cuadre. La edición de metadatos es
 * compare-and-swap por `version` (los movimientos también la suben).
 */

const LOTE_COLUMNS = `l.id, l.articulo_id, l.lote, l.caducidad, l.condicion,
  l.ubicacion, l.cantidad, l.version, l.created_at, l.updated_at,
  a.sku, a.nombre, a.um`

const LOTE_FROM = `FROM inventory_lots l JOIN articulos a ON a.id = l.articulo_id`

/** Caducidad como string YYYY-MM-DD: el parser DATE de node-pg devuelve
 * Date en la zona local del proceso y corrompería el día calendario. */
const CADUCIDAD_ISO = `to_char(l.caducidad, 'YYYY-MM-DD') AS caducidad`

export type FiltroCaducidad = "vencidos" | "por_vencer" | "all"
export type FiltroCondicion = "nuevo" | "usado" | "danado" | "all"

export interface FiltrosLotes {
  q?: string
  condicion?: FiltroCondicion
  caducidad?: FiltroCaducidad
}

export interface ListadoLotes {
  lotes: LoteInventario[]
  total: number
}

/** Lotes del tenant (solo artículos ACTIVOS del catálogo), ordenados por
 * artículo y caducidad. El listado alimenta el acordeón completo: sin
 * paginación, acotado por el tope de lotes por tenant. */
export async function listarLotes(
  filtros: FiltrosLotes = {}
): Promise<ListadoLotes> {
  const termino = typeof filtros.q === "string" ? filtros.q.trim() : ""
  const conBusqueda = termino.length >= 2
  const hoy = hoyIsoCdmx()

  const condiciones: string[] = ["a.status = 'active'"]
  const params: unknown[] = []
  const p = (valor: unknown): string => `$${params.push(valor)}`

  if (conBusqueda) {
    const patron = p(patronBusqueda(termino))
    condiciones.push(
      `(a.nombre ILIKE ${patron} OR a.sku ILIKE ${patron} OR l.lote ILIKE ${patron} OR l.ubicacion ILIKE ${patron})`
    )
  }
  if (filtros.condicion && filtros.condicion !== "all") {
    condiciones.push(`l.condicion = ${p(filtros.condicion)}`)
  }
  if (filtros.caducidad === "vencidos") {
    condiciones.push(
      `l.caducidad IS NOT NULL AND l.caducidad < ${p(hoy)}::date`
    )
  } else if (filtros.caducidad === "por_vencer") {
    condiciones.push(
      `l.caducidad IS NOT NULL AND l.caducidad BETWEEN ${p(hoy)}::date AND ${p(hoy)}::date + ${INVENTARIO_DIAS_POR_VENCER}`
    )
  }

  const { rows } = await pool.query(
    `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO}, count(*) OVER() AS total
       ${LOTE_FROM}
      WHERE ${condiciones.join(" AND ")}
      ORDER BY a.nombre ASC, l.caducidad ASC NULLS LAST, l.created_at ASC
      LIMIT ${p(INVENTARIO_MAX_LOTES_POR_TENANT)}`,
    params
  )

  return {
    lotes: rows.map(loteDeRow),
    total: Number(rows[0]?.total ?? 0),
  }
}

/** Cifras del resumen para el encabezado, contra el día actual de CDMX. */
export async function resumenInventario(): Promise<ResumenInventario> {
  const hoy = hoyIsoCdmx()
  const { rows } = await pool.query(
    `SELECT
       count(DISTINCT CASE WHEN l.cantidad > 0 THEN l.articulo_id END)::int
         AS articulos_con_stock,
       COALESCE(sum(l.cantidad), 0) AS unidades_totales,
       count(*) FILTER (WHERE l.caducidad IS NOT NULL AND l.caducidad < $1::date)::int
         AS lotes_vencidos,
       count(*) FILTER (WHERE l.caducidad IS NOT NULL
         AND l.caducidad BETWEEN $1::date AND $1::date + ${INVENTARIO_DIAS_POR_VENCER})::int
         AS lotes_por_vencer,
       COALESCE(sum(l.cantidad) FILTER (WHERE l.condicion = 'danado'), 0)
         AS unidades_danadas
       ${LOTE_FROM}
      WHERE a.status = 'active'`,
    [hoy]
  )
  const row = rows[0] ?? {}
  return {
    articulosConStock: Number(row.articulos_con_stock ?? 0),
    unidadesTotales: Number(row.unidades_totales ?? 0),
    lotesPorVencer: Number(row.lotes_por_vencer ?? 0),
    lotesVencidos: Number(row.lotes_vencidos ?? 0),
    unidadesDanadas: Number(row.unidades_danadas ?? 0),
  }
}

/**
 * Crea el lote respetando el tope por tenant: el advisory lock serializa
 * las escrituras del mismo tenant y el count dentro de la misma transacción
 * no puede quedar viejo (patrón del catálogo de artículos). Con cantidad
 * inicial > 0 registra la ENTRADA de alta en la misma transacción.
 */
export async function crearLote(
  input: LoteInput,
  userId: string
): Promise<LoteInventario> {
  const creado = await withTransaction(async (client) => {
    await lockPorTenant(client)

    const articulo = await client.query(
      `SELECT id, sku, nombre, um, status FROM articulos WHERE id = $1::uuid`,
      [input.articuloId]
    )
    if (articulo.rows.length === 0) throw articuloNoEncontrado()
    if (articulo.rows[0].status !== "active") {
      throw new AppError(
        422,
        "articulo_archivado",
        "El artículo está archivado en el catálogo: restáuralo para poder inventariarlo."
      )
    }

    await exigirCupo(client, 1)

    const insertadas = await client.query(
      `INSERT INTO inventory_lots
         (articulo_id, lote, caducidad, condicion, ubicacion, cantidad, created_by, updated_by)
       VALUES ($1::uuid, $2, $3::date, $4, $5, $6, $7::uuid, $7::uuid)
       RETURNING id`,
      [
        input.articuloId,
        input.lote,
        input.caducidad,
        input.condicion,
        input.ubicacion,
        input.cantidadInicial,
        userId,
      ]
    )
    const loteRow = insertadas.rows[0]

    if (input.cantidadInicial > 0) {
      await client.query(
        `INSERT INTO inventory_movements
           (lote_id, kind, delta, cantidad_antes, cantidad_despues, motivo, created_by)
         VALUES ($1::uuid, 'entrada', $2, 0, $2, 'Alta del lote', $3::uuid)`,
        [loteRow.id, input.cantidadInicial, userId]
      )
    }

    const { rows } = await client.query(
      `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO} ${LOTE_FROM} WHERE l.id = $1::uuid`,
      [loteRow.id]
    )
    return loteDeRow(rows[0])
  })
  // Realtime tras el COMMIT: el pool publica en otra conexión y jamás
  // avisaría de una escritura que aún no existe.
  notifyInventarioChanged()
  return creado
}

/**
 * Reemplaza los METADATOS del lote (código, caducidad, condición, ubicación)
 * bajo compare-and-swap: la petición trae la `version` conocida; si la fila
 * cambió (otro dispositivo o un movimiento) responde 409 con la vigente.
 * La CANTIDAD jamás pasa por aquí: solo cambia con movimientos.
 */
export async function actualizarLoteMeta(
  id: string,
  meta: LoteMetaInput,
  version: number,
  userId: string
): Promise<LoteInventario> {
  if (!esUuidValido(id)) throw loteNoEncontrado()
  const actualizado = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO} ${LOTE_FROM}
        WHERE l.id = $1::uuid
        FOR UPDATE OF l`,
      [id]
    )
    if (rows.length === 0) throw loteNoEncontrado()
    const vigente = loteDeRow(rows[0])
    if (vigente.version !== version) {
      throw new AppError(
        409,
        "version_conflict",
        "El lote cambió en otro dispositivo o pestaña. Recarga para ver la versión actual.",
        { lote: vigente }
      )
    }
    const { rows: actualizadas } = await client.query(
      `UPDATE inventory_lots l
          SET lote = $2, caducidad = $3::date, condicion = $4, ubicacion = $5,
              version = l.version + 1, updated_by = $6::uuid, updated_at = now()
        WHERE l.id = $1::uuid
        RETURNING l.id`,
      [id, meta.lote, meta.caducidad, meta.condicion, meta.ubicacion, userId]
    )
    const { rows: refrescadas } = await client.query(
      `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO} ${LOTE_FROM} WHERE l.id = $1::uuid`,
      [actualizadas[0].id]
    )
    return loteDeRow(refrescadas[0])
  })
  notifyInventarioChanged()
  return actualizado
}

export interface ResultadoMovimiento {
  lote: LoteInventario
  movimiento: MovimientoInventario
}

/**
 * Registra un movimiento en UNA transacción: bloquea la fila del lote,
 * calcula el delta (salida sin stock → 422; ajuste sin cambios → 422),
 * inserta el movimiento con antes/después y actualiza el balance. El CHECK
 * de balance de la tabla es la red de seguridad final.
 */
export async function registrarMovimiento(
  loteId: string,
  input: MovimientoInput,
  userId: string
): Promise<ResultadoMovimiento> {
  if (!esUuidValido(loteId)) throw loteNoEncontrado()
  const resultado = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO} ${LOTE_FROM}
        WHERE l.id = $1::uuid
        FOR UPDATE OF l`,
      [loteId]
    )
    if (rows.length === 0) throw loteNoEncontrado()
    const vigente = loteDeRow(rows[0])

    const antes = vigente.cantidad
    let delta: number
    let despues: number
    if (input.kind === "entrada") {
      delta = input.cantidad as number
      despues = Math.round((antes + delta) * 1000) / 1000
      if (despues > INVENTARIO_CANTIDAD_MAX) {
        throw new AppError(
          422,
          "stock_limite",
          "La cantidad resultante supera el tope por lote."
        )
      }
    } else if (input.kind === "salida") {
      const cantidad = input.cantidad as number
      if (cantidad > antes) {
        throw new AppError(
          422,
          "stock_insuficiente",
          `El lote solo tiene ${antes.toLocaleString("es-MX")} unidades: no alcanza para una salida de ${cantidad.toLocaleString("es-MX")}.`,
          { stock: antes }
        )
      }
      delta = -cantidad
      despues = Math.round((antes - cantidad) * 1000) / 1000
    } else {
      const objetivo = input.cantidadObjetivo as number
      delta = Math.round((objetivo - antes) * 1000) / 1000
      if (delta === 0) {
        throw new AppError(
          422,
          "sin_cambios",
          "El conteo físico coincide con la cantidad registrada: no hay nada que ajustar."
        )
      }
      despues = objetivo
    }

    const insertado = await client.query(
      `INSERT INTO inventory_movements
         (lote_id, kind, delta, cantidad_antes, cantidad_despues, motivo, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
       RETURNING id`,
      [loteId, input.kind, delta, antes, despues, input.motivo, userId]
    )
    await client.query(
      `UPDATE inventory_lots l
          SET cantidad = $2, version = l.version + 1,
              updated_by = $3::uuid, updated_at = now()
        WHERE l.id = $1::uuid`,
      [loteId, despues, userId]
    )

    const { rows: refrescadas } = await client.query(
      `SELECT ${LOTE_COLUMNS}, ${CADUCIDAD_ISO} ${LOTE_FROM} WHERE l.id = $1::uuid`,
      [loteId]
    )
    const { rows: movRows } = await client.query(
      `SELECT m.*, ${CADUCIDAD_ISO}, l.articulo_id, l.lote, a.sku, a.nombre
         FROM inventory_movements m
         JOIN inventory_lots l ON l.id = m.lote_id
         JOIN articulos a ON a.id = l.articulo_id
        WHERE m.id = $1::uuid`,
      [insertado.rows[0].id]
    )
    return {
      lote: loteDeRow(refrescadas[0]),
      movimiento: movimientoDeRow(movRows[0]),
    }
  })
  notifyInventarioChanged()
  return resultado
}

/** Kardex paginado: por lote, por artículo o todo el tenant. */
export interface FiltrosMovimientos {
  loteId?: string
  articuloId?: string
  page?: number
  pageSize?: number
}

export interface ListadoMovimientos {
  movimientos: MovimientoInventario[]
  total: number
}

export const MOVIMIENTOS_PAGE_SIZE_DEFAULT = 30
export const MOVIMIENTOS_PAGE_SIZE_MAX = 200

const MOVIMIENTO_FROM = `FROM inventory_movements m
  JOIN inventory_lots l ON l.id = m.lote_id
  JOIN articulos a ON a.id = l.articulo_id`

export async function listarMovimientos(
  filtros: FiltrosMovimientos = {}
): Promise<ListadoMovimientos> {
  const condiciones: string[] = []
  const params: unknown[] = []
  const p = (valor: unknown): string => `$${params.push(valor)}`

  if (filtros.loteId !== undefined) {
    if (!esUuidValido(filtros.loteId)) throw loteNoEncontrado()
    condiciones.push(`m.lote_id = ${p(filtros.loteId)}::uuid`)
  }
  if (filtros.articuloId !== undefined) {
    if (!esArticuloIdValido(filtros.articuloId)) throw articuloNoEncontrado()
    condiciones.push(`l.articulo_id = ${p(filtros.articuloId)}::uuid`)
  }

  const page = Math.max(1, Math.floor(Number(filtros.page) || 1))
  const pageSize = Math.min(
    MOVIMIENTOS_PAGE_SIZE_MAX,
    Math.max(1, Math.floor(Number(filtros.pageSize) || MOVIMIENTOS_PAGE_SIZE_DEFAULT))
  )

  const { rows } = await pool.query(
    `SELECT m.*, ${CADUCIDAD_ISO},
            l.articulo_id, l.lote, a.sku, a.nombre,
            count(*) OVER() AS total
       ${MOVIMIENTO_FROM}
      ${condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : ""}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${p(pageSize)} OFFSET ${p((page - 1) * pageSize)}`,
    params
  )

  return {
    movimientos: rows.map(movimientoDeRow),
    total: Number(rows[0]?.total ?? 0),
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Advisory lock por tenant: serializa cupo y altas del mismo tenant. */
async function lockPorTenant(client: {
  query: (sql: string) => Promise<unknown>
}): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended(COALESCE(current_setting('app.tenant_id', true), ''), 0)
     )`
  )
}

/** Exige cupo de lotes: el count corre bajo el lock, en la misma transacción. */
async function exigirCupo(
  client: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: Record<string, unknown>[] }>
  },
  porAgregar: number
): Promise<void> {
  const count = await client.query(
    "SELECT count(*)::int AS count FROM inventory_lots"
  )
  const actuales = Number(count.rows[0]?.count ?? 0)
  if (actuales + porAgregar > INVENTARIO_MAX_LOTES_POR_TENANT) {
    throw new AppError(
      422,
      "limite_lotes",
      `Llegaste al tope de ${INVENTARIO_MAX_LOTES_POR_TENANT.toLocaleString(
        "es-MX"
      )} lotes del negocio. Agota o cierra lotes viejos (cantidad en cero) para abrir otros nuevos.`,
      { limit: INVENTARIO_MAX_LOTES_POR_TENANT }
    )
  }
}

function loteNoEncontrado(): AppError {
  return new AppError(404, "lote_no_encontrado", "El lote no existe.")
}

function articuloNoEncontrado(): AppError {
  return new AppError(
    404,
    "articulo_no_encontrado",
    "El artículo no existe en el catálogo."
  )
}

/** Tiempo real: otras pestañas/dispositivos refrescan el inventario en vivo. */
function notifyInventarioChanged(): void {
  import("@/server/realtime/bus")
    .then(({ publishRealtimeDetached }) =>
      publishRealtimeDetached({ kind: "inventario" })
    )
    .catch(() => undefined)
}
