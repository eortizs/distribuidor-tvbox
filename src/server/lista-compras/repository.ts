import { createHash, randomUUID } from "node:crypto"

import {
  aplicarOperaciones,
  capitalizarPrimeraLetra,
  normalizarCategoria,
  normalizarUnidad,
  requiereConfirmacion,
  validarOperaciones,
  type ItemLista,
  type Operacion,
  type SnapshotLista,
} from "@/lib/lista-compras"
import { pool, withTransaction } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Repositorio de la lista de compras. Toda lectura y mutación llega con el
 * id del usuario de sesión y el SQL filtra por él, así que un usuario nunca
 * lee ni escribe la lista de otro. Las mutaciones son transaccionales con
 * compare-and-swap por `revision` (incluido el primer insert concurrente) y
 * quedan anotadas en `shopping_list_mutations` para que reintentar un
 * `request_id` sea idempotente.
 */

const LIMITE_OPS = 50

export interface PeticionMutacion {
  revision: number
  requestId: string
  confirmar: boolean
  ops: unknown
}

function parseItems(raw: unknown): ItemLista[] {
  if (!Array.isArray(raw)) return []
  const items: ItemLista[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const it = item as Record<string, unknown>
    if (typeof it.id !== "string" || !it.id) continue
    const nombre = capitalizarPrimeraLetra(
      typeof it.nombre === "string" ? it.nombre.trim().slice(0, 80) : ""
    )
    if (!nombre) continue
    const cantidad =
      typeof it.cantidad === "number" &&
      Number.isFinite(it.cantidad) &&
      it.cantidad > 0
        ? it.cantidad
        : null
    items.push({
      id: it.id,
      nombre,
      categoria: normalizarCategoria(it.categoria),
      cantidad,
      unidad: normalizarUnidad(it.unidad),
      comprado: it.comprado === true,
      estimado: it.estimado === true,
    })
  }
  return items
}

function snapshotDe(
  row: Record<string, unknown> | undefined
): SnapshotLista {
  return {
    items: row ? parseItems(row.items) : [],
    revision: row ? Number(row.revision) || 0 : 0,
  }
}

function hashPayload(revision: number, ops: Operacion[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ revision, ops }))
    .digest("hex")
}

export async function obtenerLista(userId: string): Promise<SnapshotLista> {
  const { rows } = await pool.query(
    "SELECT items, revision FROM shopping_lists WHERE user_id = $1",
    [userId]
  )
  return snapshotDe(rows[0])
}

/**
 * Aplica una tanda de operaciones de forma atómica:
 * 1. `request_id` repetido con el mismo payload devuelve el snapshot actual
 *    sin aplicar nada (reintento seguro).
 * 2. `request_id` repetido con payload distinto se rechaza.
 * 3. `revision` distinta a la guardada responde 409 con el snapshot actual:
 *    el cliente refresca y decide, nunca se sobrescribe a ciegas.
 * 4. Operaciones destructivas (vaciar, reemplazar, eliminar productos) exigen
 *    `confirmar: true`; la necesidad se deriva aquí, no del LLM ni del cliente.
 */
export async function aplicarMutacion(
  userId: string,
  peticion: PeticionMutacion
): Promise<SnapshotLista> {
  const ops = validarOperaciones(peticion.ops)
  if (ops.length === 0) {
    throw new AppError(
      422,
      "operaciones_invalidas",
      "No hay operaciones válidas para aplicar."
    )
  }
  if (ops.length > LIMITE_OPS) {
    throw new AppError(
      422,
      "operaciones_invalidas",
      "Demasiadas operaciones en una sola petición."
    )
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT items, revision FROM shopping_lists WHERE user_id = $1 FOR UPDATE",
      [userId]
    )
    const actual = snapshotDe(rows[0])

    const { rows: logRows } = await client.query(
      "SELECT payload_hash FROM shopping_list_mutations WHERE user_id = $1 AND request_id = $2",
      [userId, peticion.requestId]
    )
    const hash = hashPayload(peticion.revision, ops)
    if (logRows.length > 0) {
      const previo = String(logRows[0].payload_hash)
      if (previo === hash) {
        // Reintento idéntico: la mutación ya quedó aplicada (o no aplicó
        // nada); el snapshot actual es la respuesta correcta.
        return actual
      }
      throw new AppError(
        409,
        "request_id_duplicado",
        "Este identificador de petición ya se usó con datos distintos. Genera uno nuevo.",
        { snapshot: actual }
      )
    }

    if (actual.revision !== peticion.revision) {
      throw new AppError(
        409,
        "revision_conflict",
        "La lista cambió en otro dispositivo o pestaña. Revisa el estado actual y vuelve a aplicar.",
        { snapshot: actual }
      )
    }

    if (requiereConfirmacion(actual.items, ops) && !peticion.confirmar) {
      throw new AppError(
        422,
        "confirmacion_requerida",
        "Esta operación reemplaza o vacía la lista y necesita confirmación explícita.",
        { snapshot: actual }
      )
    }

    const aplicado = aplicarOperaciones(actual.items, ops)
    if (!aplicado.ok) {
      throw new AppError(422, "operaciones_invalidas", aplicado.razon, {
        snapshot: actual,
      })
    }

    // Los IDs de productos nuevos los genera el servidor: el dominio deja ""
    // como marcador.
    const conIds = aplicado.items.map((item) =>
      item.id === "" ? { ...item, id: randomUUID() } : item
    )
    const nuevaRevision = actual.revision + 1

    await client.query(
      `INSERT INTO shopping_lists (user_id, items, revision)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET items = $2::jsonb, revision = $3, updated_at = now()`,
      [userId, JSON.stringify(conIds), nuevaRevision]
    )
    await client.query(
      `INSERT INTO shopping_list_mutations
         (user_id, request_id, payload_hash, revision_before, revision_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, peticion.requestId, hash, actual.revision, nuevaRevision]
    )

    return { items: conIds, revision: nuevaRevision }
  })
}
