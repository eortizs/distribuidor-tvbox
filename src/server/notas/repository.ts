import {
  esNotaIdValido,
  notaDeRow,
  NOTA_PREVIEW_CHARS,
  NOTAS_BUSQUEDA_MIN,
  NOTAS_MAX_POR_USUARIO,
  patronBusqueda,
  previewDeRow,
  type Nota,
  type NotaInput,
  type NotaPreview,
} from "@/lib/notas"
import { pool, withTransaction } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Repositorio de Notas. Toda lectura y mutación llega con el id del usuario
 * de sesión y el SQL filtra por él: un usuario nunca lee ni escribe notas de
 * otro (un id ajeno o inexistente responde 404, no 403, para no revelar
 * existencia). La creación aplica el tope de notas por usuario dentro de una
 * transacción con advisory lock por usuario (patrón `insertAlertCapped`:
 * count + insert atómicos, sin carrera TOCTOU). La edición es
 * compare-and-swap por la `version` de la nota: si otra pestaña/dispositivo
 * la cambió, responde 409 con la nota vigente en el detalle.
 */

const NOTA_COLUMNS = `id, user_id, title, body, pinned, version, created_at, updated_at`

/** Renglones del listado: orden fijadas primero, luego últimas editadas. */
export async function listarNotas(
  userId: string,
  q?: string
): Promise<NotaPreview[]> {
  const termino = typeof q === "string" ? q.trim() : ""
  const conBusqueda = termino.length >= NOTAS_BUSQUEDA_MIN
  const { rows } = await pool.query(
    `SELECT id, title, left(body, ${NOTA_PREVIEW_CHARS}) AS body, pinned, updated_at
       FROM notes
      WHERE user_id = $1::uuid
        ${conBusqueda ? "AND (title ILIKE $2 OR body ILIKE $2)" : ""}
      ORDER BY pinned DESC, updated_at DESC`,
    conBusqueda ? [userId, patronBusqueda(termino)] : [userId]
  )
  return rows.map(previewDeRow)
}

/** Nota completa (para editar). 404 si no existe o es de otro usuario. */
export async function obtenerNota(userId: string, id: string): Promise<Nota> {
  if (!esNotaIdValido(id)) throw notaNoEncontrada()
  const { rows } = await pool.query(
    `SELECT ${NOTA_COLUMNS} FROM notes WHERE id = $1::uuid AND user_id = $2::uuid`,
    [id, userId]
  )
  if (rows.length === 0) throw notaNoEncontrada()
  return notaDeRow(rows[0])
}

/**
 * Crea la nota respetando el tope de notas por usuario: el advisory lock
 * serializa las creaciones de la misma cuenta y el count corriendo dentro
 * de la misma transacción no puede quedar viejo.
 */
export async function crearNota(
  userId: string,
  input: NotaInput
): Promise<Nota> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      userId,
    ])
    const count = await client.query(
      "SELECT count(*)::int AS count FROM notes WHERE user_id = $1::uuid",
      [userId]
    )
    if (Number(count.rows[0]?.count ?? 0) >= NOTAS_MAX_POR_USUARIO) {
      throw new AppError(
        422,
        "limite_notas",
        `Llegaste al tope de ${NOTAS_MAX_POR_USUARIO} notas. Elimina alguna para crear otra.`,
        { limit: NOTAS_MAX_POR_USUARIO }
      )
    }
    const { rows } = await client.query(
      `INSERT INTO notes (user_id, title, body, pinned)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING ${NOTA_COLUMNS}`,
      [userId, input.title, input.body, input.pinned]
    )
    return notaDeRow(rows[0])
  })
}

/**
 * Reemplaza el contenido de la nota (título, texto, fijada) bajo
 * compare-and-swap: la petición trae la `version` que el cliente conocía y
 * si la nota cambió desde entonces responde 409 con la nota vigente para
 * que el usuario decida (recargar o descartar), nunca se pisa a ciegas.
 */
export async function actualizarNota(
  userId: string,
  id: string,
  input: NotaInput,
  version: number
): Promise<Nota> {
  if (!esNotaIdValido(id)) throw notaNoEncontrada()
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${NOTA_COLUMNS} FROM notes
        WHERE id = $1::uuid AND user_id = $2::uuid
        FOR UPDATE`,
      [id, userId]
    )
    if (rows.length === 0) throw notaNoEncontrada()
    const actual = notaDeRow(rows[0])
    if (actual.version !== version) {
      throw new AppError(
        409,
        "version_conflict",
        "La nota cambió en otro dispositivo o pestaña. Recarga para ver la versión actual.",
        { nota: actual }
      )
    }
    const { rows: actualizadas } = await client.query(
      `UPDATE notes
          SET title = $3, body = $4, pinned = $5,
              version = version + 1, updated_at = now()
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING ${NOTA_COLUMNS}`,
      [id, userId, input.title, input.body, input.pinned]
    )
    return notaDeRow(actualizadas[0])
  })
}

/** Borra la nota. 404 si no existe o es de otro usuario. */
export async function eliminarNota(userId: string, id: string): Promise<void> {
  if (!esNotaIdValido(id)) throw notaNoEncontrada()
  const result = await pool.query(
    "DELETE FROM notes WHERE id = $1::uuid AND user_id = $2::uuid",
    [id, userId]
  )
  if ((result.rowCount ?? 0) === 0) throw notaNoEncontrada()
}

function notaNoEncontrada(): AppError {
  return new AppError(404, "nota_no_encontrada", "La nota no existe.")
}
