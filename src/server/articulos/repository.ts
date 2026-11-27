import {
  articuloDeRow,
  articuloResumenDeRow,
  ARTICULOS_BUSQUEDA_MIN,
  ARTICULOS_MAX_POR_TENANT,
  ARTICULOS_PAGE_SIZE_DEFAULT,
  ARTICULOS_PAGE_SIZE_MAX,
  esArticuloIdValido,
  patronBusqueda,
  type Articulo,
  type ArticuloInput,
} from "@/lib/articulos"
import { pool, withTransaction } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Repositorio del catálogo de artículos. El alcance es el TENANT completo
 * (propietario y sucursales comparten el catálogo): el aislamiento lo hace
 * RLS — el pool fija app.tenant_id por consulta y toda fila ajena es
 * invisible, así que un id ajeno o inexistente responde 404, no 403, para
 * no revelar existencia. NUNCA se borra una fila (el permiso DELETE está
 * revocado): «eliminar» es archivar (status='archived'). La edición es
 * compare-and-swap por `version`: si otra pestaña cambió la fila responde
 * 409 con la versión vigente. Los topes (5 000 artículos por tenant) y la
 * importación corren bajo advisory lock por tenant: count + escritura
 * atómicos, sin carrera TOCTOU.
 */

const ARTICULO_COLUMNS = `id, tenant_id, sku, nombre, descripcion, um,
  precio_unitario, categoria, disponible, status, version,
  created_by, updated_by, created_at, updated_at`

export type EstadoFiltro = "active" | "archived" | "all"

export interface FiltrosArticulos {
  q?: string
  status?: EstadoFiltro
  categoria?: string
  disponible?: boolean
  page?: number
  pageSize?: number
  /** Id de columna del ordenamiento (whitelist en ORDEN_COLUMNAS). */
  sort?: string
  dir?: "asc" | "desc"
}

export interface ListadoArticulos {
  articulos: Articulo[]
  total: number
}

/** Columnas de ordenamiento permitidas (id de columna → SQL). */
const ORDEN_COLUMNAS: Record<string, string> = {
  sku: "sku",
  nombre: "nombre",
  um: "um",
  precioUnitario: "precio_unitario",
  categoria: "categoria",
  disponible: "disponible",
  updatedAt: "updated_at",
}

export async function listarArticulos(
  filtros: FiltrosArticulos = {}
): Promise<ListadoArticulos> {
  const termino = typeof filtros.q === "string" ? filtros.q.trim() : ""
  const conBusqueda = termino.length >= ARTICULOS_BUSQUEDA_MIN
  const estado: EstadoFiltro = filtros.status ?? "active"
  const categoria =
    typeof filtros.categoria === "string" && filtros.categoria.trim()
      ? filtros.categoria.trim()
      : null

  const condiciones: string[] = []
  const params: unknown[] = []
  const p = (valor: unknown): string => `$${params.push(valor)}`

  if (estado !== "all") {
    condiciones.push(`status = ${p(estado)}`)
  }
  if (conBusqueda) {
    const patron = p(patronBusqueda(termino))
    condiciones.push(
      `(sku ILIKE ${patron} OR nombre ILIKE ${patron} OR descripcion ILIKE ${patron} OR categoria ILIKE ${patron})`
    )
  }
  if (categoria) {
    condiciones.push(`lower(categoria) = lower(${p(categoria)})`)
  }
  if (typeof filtros.disponible === "boolean") {
    condiciones.push(`disponible = ${p(filtros.disponible)}`)
  }

  const columna = ORDEN_COLUMNAS[filtros.sort ?? ""] ?? "updated_at"
  const direccion = filtros.dir === "asc" ? "ASC" : "DESC"
  const page = Math.max(1, Math.floor(Number(filtros.page) || 1))
  const pageSize = Math.min(
    ARTICULOS_PAGE_SIZE_MAX,
    Math.max(1, Math.floor(Number(filtros.pageSize) || ARTICULOS_PAGE_SIZE_DEFAULT))
  )

  const { rows } = await pool.query(
    `SELECT ${ARTICULO_COLUMNS}, count(*) OVER() AS total
       FROM articulos
      ${condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : ""}
      ORDER BY ${columna} ${direccion}, id DESC
      LIMIT ${p(pageSize)} OFFSET ${p((page - 1) * pageSize)}`,
    params
  )

  return {
    articulos: rows.map(articuloResumenDeRow),
    total: Number(rows[0]?.total ?? 0),
  }
}

/** Artículo completo (para editar). 404 si no existe o es de otro tenant. */
export async function obtenerArticulo(id: string): Promise<Articulo> {
  if (!esArticuloIdValido(id)) throw articuloNoEncontrado()
  const { rows } = await pool.query(
    `SELECT ${ARTICULO_COLUMNS} FROM articulos WHERE id = $1::uuid`,
    [id]
  )
  if (rows.length === 0) throw articuloNoEncontrado()
  return articuloDeRow(rows[0])
}

/**
 * Crea el artículo respetando el tope por tenant: el advisory lock serializa
 * las escrituras del mismo tenant y el count dentro de la misma transacción
 * no puede quedar viejo (patrón `crearNota`).
 */
export async function crearArticulo(
  input: ArticuloInput,
  userId: string
): Promise<Articulo> {
  try {
    const creado = await withTransaction(async (client) => {
      await lockPorTenant(client)
      await exigirCupo(client, 1)
      const { rows } = await client.query(
        `INSERT INTO articulos
           (sku, nombre, descripcion, um, precio_unitario, categoria,
            disponible, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $8::uuid)
         RETURNING ${ARTICULO_COLUMNS}`,
        [
          input.sku,
          input.nombre,
          input.descripcion,
          input.um,
          input.precioUnitario,
          input.categoria,
          input.disponible,
          userId,
        ]
      )
      return articuloDeRow(rows[0])
    })
    notifyArticulosChanged()
    return creado
  } catch (error) {
    if (esUnicoViolado(error)) throw skuDuplicado(input.sku)
    throw error
  }
}

/**
 * Reemplaza el contenido del artículo bajo compare-and-swap: la petición
 * trae la `version` que el cliente conocía; si la fila cambió desde
 * entonces responde 409 con la vigente para que el usuario decida
 * (recargar o descartar), nunca se pisa a ciegas. `status` opcional:
 * archivar/restaurar sin tocar nada más viaja en el mismo PATCH.
 */
export async function actualizarArticulo(
  id: string,
  input: ArticuloInput,
  version: number,
  userId: string,
  status?: "active" | "archived"
): Promise<Articulo> {
  if (!esArticuloIdValido(id)) throw articuloNoEncontrado()
  try {
    const actualizado = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ${ARTICULO_COLUMNS} FROM articulos
          WHERE id = $1::uuid
          FOR UPDATE`,
        [id]
      )
      if (rows.length === 0) throw articuloNoEncontrado()
      const actual = articuloDeRow(rows[0])
      if (actual.version !== version) {
        throw new AppError(
          409,
          "version_conflict",
          "El artículo cambió en otro dispositivo o pestaña. Recarga para ver la versión actual.",
          { articulo: actual }
        )
      }
      const { rows: actualizadas } = await client.query(
        `UPDATE articulos
            SET sku = $2, nombre = $3, descripcion = $4, um = $5,
                precio_unitario = $6, categoria = $7, disponible = $8,
                status = COALESCE($9, status),
                version = version + 1, updated_by = $10::uuid, updated_at = now()
          WHERE id = $1::uuid
          RETURNING ${ARTICULO_COLUMNS}`,
        [
          id,
          input.sku,
          input.nombre,
          input.descripcion,
          input.um,
          input.precioUnitario,
          input.categoria,
          input.disponible,
          status ?? null,
          userId,
        ]
      )
      return articuloDeRow(actualizadas[0])
    })
    notifyArticulosChanged()
    return actualizado
  } catch (error) {
    if (esUnicoViolado(error)) throw skuDuplicado(input.sku)
    throw error
  }
}

/** Categorías ya usadas en el tenant, para las sugerencias del formulario y
 * el filtro del listado. Respeta el estado que está viendo la vista: en
 * «Archivados» sugiere categorías de archivados (con solo activos, una
 * categoría cuyos artículos están todos archivados desaparecería del filtro
 * justo donde el flujo de restauración la necesita). */
export async function listarCategorias(
  estado: "active" | "archived" | "all" = "active"
): Promise<string[]> {
  const conEstado = estado !== "all"
  const { rows } = await pool.query(
    `SELECT DISTINCT categoria FROM articulos
      ${conEstado ? "WHERE status = $1 AND" : "WHERE"} categoria IS NOT NULL
      ORDER BY categoria
      LIMIT 200`,
    conEstado ? [estado] : []
  )
  return rows.map((row) => String(row.categoria))
}

/** SKUs de la lista que YA existen en el tenant (para el informe de la
 * vista previa: nuevos vs actualizados exactos, sin escribir nada). */
export async function contarSkusExistentes(
  skus: string[]
): Promise<Set<string>> {
  if (skus.length === 0) return new Set()
  const { rows } = await pool.query(
    "SELECT sku FROM articulos WHERE sku = ANY($1)",
    [skus]
  )
  return new Set(rows.map((row) => String(row.sku)))
}

export interface ResultadoImportacion {
  nuevos: number
  actualizados: number
}

/**
 * Upsert de la importación en UNA transacción: todos los renglones entran
 * o ninguno. El advisory lock serializa importaciones concurrentes del
 * mismo tenant y el cupo se verifica antes de escribir. Los SKU existentes
 * se ACTUALIZAN con los datos del archivo y quedan activos (el CSV no trae
 * status: importar implica que el artículo vive en el catálogo); los nuevos
 * se insertan. Un `aplicar` repetido es inocuo: el upsert vuelve a dejar
 * los mismos datos. Publica realtime tras el COMMIT.
 */
export async function importarArticulos(
  inputs: ArticuloInput[],
  userId: string
): Promise<ResultadoImportacion> {
  if (inputs.length === 0) return { nuevos: 0, actualizados: 0 }
  const resultado = await withTransaction(async (client) => {
    await lockPorTenant(client)
    // Solo los SKU que NO existen consumen cupo: un archivo de puras
    // actualizaciones no agrega filas y no puede chocar con el tope.
    const existentes = await client.query(
      "SELECT sku FROM articulos WHERE sku = ANY($1)",
      [inputs.map((input) => input.sku)]
    )
    const porAgregar = inputs.length - existentes.rows.length
    await exigirCupo(client, porAgregar)

    let nuevos = 0
    let actualizados = 0
    // Lotes de 100 renglones × 9 parámetros: lejos del tope de bind de
    // Postgres y suficiente para el tope de 1 000 filas por archivo.
    const LOTE = 100
    for (let inicio = 0; inicio < inputs.length; inicio += LOTE) {
      const lote = inputs.slice(inicio, inicio + LOTE)
      const values: string[] = []
      const params: unknown[] = []
      lote.forEach((input, i) => {
        // 8 parámetros por renglón: el $base+8 (userId) se usa DOS veces
        // (created_by y updated_by).
        const base = i * 8
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::uuid, $${base + 8}::uuid)`
        )
        params.push(
          input.sku,
          input.nombre,
          input.descripcion,
          input.um,
          input.precioUnitario,
          input.categoria,
          input.disponible,
          userId
        )
      })
      const { rows } = await client.query(
        `INSERT INTO articulos
           (sku, nombre, descripcion, um, precio_unitario, categoria,
            disponible, created_by, updated_by)
         VALUES ${values.join(", ")}
         ON CONFLICT (tenant_id, sku) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           descripcion = EXCLUDED.descripcion,
           um = EXCLUDED.um,
           precio_unitario = EXCLUDED.precio_unitario,
           categoria = EXCLUDED.categoria,
           disponible = EXCLUDED.disponible,
           status = 'active',
           version = articulos.version + 1,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING (xmax = 0) AS insertado`,
        params
      )
      for (const row of rows) {
        if (row.insertado === true) nuevos += 1
        else actualizados += 1
      }
    }
    return { nuevos, actualizados }
  })
  notifyArticulosChanged()
  return resultado
}

/* --------------------------------- helpers -------------------------------- */

/** Advisory lock por tenant: serializa cupo y upserts del mismo tenant. */
async function lockPorTenant(client: {
  query: (sql: string) => Promise<unknown>
}): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended(COALESCE(current_setting('app.tenant_id', true), ''), 0)
     )`
  )
}

/** Exige cupo: el count corre bajo el lock, dentro de la misma transacción. */
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
    "SELECT count(*)::int AS count FROM articulos"
  )
  const actuales = Number(count.rows[0]?.count ?? 0)
  if (actuales + porAgregar > ARTICULOS_MAX_POR_TENANT) {
    throw new AppError(
      422,
      "limite_articulos",
      `Llegaste al tope de ${ARTICULOS_MAX_POR_TENANT.toLocaleString(
        "es-MX"
      )} artículos del negocio. El tope cuenta activos y archivados (el catálogo nunca borra filas): reduce tu catálogo o divide la importación para continuar.`,
      { limit: ARTICULOS_MAX_POR_TENANT }
    )
  }
}

function esUnicoViolado(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  )
}

function skuDuplicado(sku: string): AppError {
  return new AppError(
    409,
    "sku_duplicado",
    `Ya existe un artículo con el SKU «${sku}». Si está archivado, restáuralo desde el filtro «Archivados» o importa el archivo para actualizarlo.`,
    { sku }
  )
}

function articuloNoEncontrado(): AppError {
  return new AppError(
    404,
    "articulo_no_encontrado",
    "El artículo no existe."
  )
}

/** Tiempo real: otras pestañas/dispositivos refrescan el listado en vivo. */
function notifyArticulosChanged(): void {
  import("@/server/realtime/bus")
    .then(({ publishRealtimeDetached }) =>
      publishRealtimeDetached({ kind: "articulos" })
    )
    .catch(() => undefined)
}
