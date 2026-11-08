import { withTransaction } from "@/server/db"
import { createEntity } from "@/server/umejson/repository"
import { AppError, type UmeJson } from "@/server/umejson/types"
import {
  camposFaltantesParaConfirmar,
  ENTITY_NAME_TICKET,
  TICKET_KEYS,
  type DatosTicket,
} from "@/lib/tickets"

/*
 * Repositorio de tickets de compra/gasto. Toda lectura y mutación llega con
 * el id del usuario de sesión y el SQL filtra por él: ni un admin lee o
 * escribe el ticket de otro (decisión de producto: la revisión es del propio
 * usuario). El documento `entities.doc` es la fuente de verdad de los datos;
 * la tabla `tickets` lleva el vínculo con la foto, la idempotencia por
 * `request_id`, la deduplicación por sha256 y el estado del análisis.
 *
 * Las mutaciones propias NO publican en el bus de tiempo real: el SSE de
 * admin reenvía todos los eventos `entity` y estos documentos son privados
 * del propietario. El cliente refresca tras cada acción.
 */

const LEASE_SEGUNDOS = 180

export interface TicketFila {
  entityId: string
  userId: string
  fileId: string
  requestId: string
  sha256: string
  scanStatus: "pending" | "processing" | "succeeded" | "failed"
  scanError: string | null
  doc: UmeJson
  version: number
  createdAt: Date
  updatedAt: Date
}

const SELECT_TICKET = `
  SELECT t.entity_id, t.user_id, t.file_id, t.request_id, t.sha256,
         t.scan_status, t.scan_error,
         e.doc, e.version, e.created_at, e.updated_at
    FROM tickets t
    JOIN entities e ON e.id = t.entity_id`

function mapFila(row: Record<string, unknown>): TicketFila {
  return {
    entityId: row.entity_id as string,
    userId: row.user_id as string,
    fileId: row.file_id as string,
    requestId: row.request_id as string,
    sha256: row.sha256 as string,
    scanStatus: row.scan_status as TicketFila["scanStatus"],
    scanError: (row.scan_error as string | null) ?? null,
    doc: row.doc as UmeJson,
    version: row.version as number,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

export interface CrearTicketParams {
  userId: string
  fileId: string
  requestId: string
  sha256: string
  doc: UmeJson
  actor: string
}

export interface CrearTicketResultado {
  entityId: string
  /** true = el mismo archivo ya tenía un ticket (se devuelve el existente). */
  duplicado: boolean
}

/**
 * Crea la entidad draft y la fila de control en una transacción. La
 * idempotencia por `request_id` y la deduplicación por sha256 se resuelven
 * aquí, dentro de la transacción, para que dos altas concurrentes del mismo
 * archivo no creen dos registros (índices únicos + re-consulta).
 */
export async function crearTicketConEntidad(
  params: CrearTicketParams
): Promise<CrearTicketResultado> {
  return withTransaction(async (client) => {
    // Idempotencia: el mismo request_id con el mismo contenido devuelve el
    // ticket ya creado; con otro contenido es un error del cliente.
    const porRequest = await client.query(
      "SELECT entity_id, sha256 FROM tickets WHERE user_id = $1 AND request_id = $2",
      [params.userId, params.requestId]
    )
    if (porRequest.rowCount) {
      if (porRequest.rows[0].sha256 === params.sha256) {
        return { entityId: porRequest.rows[0].entity_id as string, duplicado: false }
      }
      throw new AppError(
        409,
        "request_id_duplicado",
        "Este identificador de petición ya se usó con otro archivo. Genera uno nuevo.",
      )
    }

    // Deduplicación por contenido: el mismo archivo del mismo usuario es
    // siempre el mismo ticket (no se vuelve a pagar un análisis).
    const porSha = await client.query(
      "SELECT entity_id FROM tickets WHERE user_id = $1 AND sha256 = $2",
      [params.userId, params.sha256]
    )
    if (porSha.rowCount) {
      return { entityId: porSha.rows[0].entity_id as string, duplicado: true }
    }

    const entity = await createEntity(
      params.doc,
      { actor: params.actor, source: "tickets", publish: false },
      client
    )
    try {
      await client.query(
        `INSERT INTO tickets (entity_id, user_id, file_id, request_id, sha256)
         VALUES ($1, $2, $3, $4, $5)`,
        [entity.id, params.userId, params.fileId, params.requestId, params.sha256]
      )
    } catch (error) {
      // Carrera concurrente: otro request insertó el mismo sha entre la
      // consulta y el INSERT. Se devuelve el ticket ganador.
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: string }).code === "23505"
      ) {
        const ganador = await client.query(
          "SELECT entity_id FROM tickets WHERE user_id = $1 AND sha256 = $2",
          [params.userId, params.sha256]
        )
        if (ganador.rowCount) {
          return { entityId: ganador.rows[0].entity_id as string, duplicado: true }
        }
      }
      throw error
    }
    return { entityId: entity.id, duplicado: false }
  })
}

export async function obtenerTicket(
  entityId: string,
  userId: string
): Promise<TicketFila | null> {
  const result = await withTransaction((client) =>
    client.query(
      `${SELECT_TICKET}
      WHERE t.entity_id = $1 AND t.user_id = $2 AND e.deleted_at IS NULL`,
      [entityId, userId]
    )
  )
  return result.rowCount ? mapFila(result.rows[0]) : null
}

export interface ListarTicketsOpciones {
  estado?: "borrador" | "revision" | "confirmado"
  limit?: number
  offset?: number
}

export interface ListarTicketsResultado {
  items: TicketFila[]
  total: number
}

const ESTADO_A_UME: Record<string, string> = {
  borrador: "draft",
  revision: "validation_required",
  confirmado: "active",
}

export async function listarTickets(
  userId: string,
  opciones: ListarTicketsOpciones = {}
): Promise<ListarTicketsResultado> {
  const limit = Math.min(Math.max(opciones.limit ?? 20, 1), 100)
  const offset = Math.max(opciones.offset ?? 0, 0)
  const values: unknown[] = [userId]
  let filtroEstado = ""
  if (opciones.estado) {
    values.push(ESTADO_A_UME[opciones.estado] ?? opciones.estado)
    filtroEstado = ` AND e.doc->'state'->>'current' = $${values.length}`
  }
  const result = await withTransaction((client) =>
    client.query(
      `${SELECT_TICKET},
       count(*) OVER () AS total_count
      WHERE t.user_id = $1 AND e.deleted_at IS NULL${filtroEstado}
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
      values
    )
  )
  return {
    items: result.rows.map(mapFila),
    total:
      result.rows.length > 0 ? Number(result.rows[0].total_count) : 0,
  }
}

/** true si algún ticket vivo referencia el archivo (protege el borrado). */
export async function ticketReferenciaActiva(fileId: string): Promise<boolean> {
  const result = await withTransaction((client) =>
    client.query(
      `SELECT 1 FROM tickets t
        JOIN entities e ON e.id = t.entity_id
       WHERE t.file_id = $1 AND e.deleted_at IS NULL
       LIMIT 1`,
      [fileId]
    )
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Lease de análisis (single-flight entre procesos): marca `processing` con
 * vencimiento y devuelve el número de intento. Solo permite analizar
 * borradores sin datos, con intento anterior terminado (pending/failed) o
 * con lease vencido (proceso muerto a mitad del análisis). null = no toca.
 */
export async function intentarLeaseScan(
  entityId: string,
  userId: string
): Promise<{ intento: number } | null> {
  const result = await withTransaction((client) =>
    client.query(
      `UPDATE tickets t
          SET scan_status = 'processing',
              scan_attempt = t.scan_attempt + 1,
              scan_lease_until = now() + ($3::int * interval '1 second'),
              scan_error = NULL,
              updated_at = now()
         FROM entities e
        WHERE t.entity_id = e.id
          AND t.entity_id = $1
          AND t.user_id = $2
          AND e.deleted_at IS NULL
          AND e.doc->'state'->>'current' = 'draft'
          AND (e.doc #> '{dynamicProperties,datos}' IS NULL
               OR e.doc #> '{dynamicProperties,datos}' = 'null'::jsonb)
          AND (t.scan_status IN ('pending', 'failed')
               OR (t.scan_status = 'processing'
                   AND (t.scan_lease_until IS NULL OR t.scan_lease_until < now())))
      RETURNING t.scan_attempt`,
      [entityId, userId, LEASE_SEGUNDOS]
    )
  )
  if (!result.rowCount) return null
  return { intento: Number(result.rows[0].scan_attempt) }
}

/** Razón por la que no se obtuvo lease (para el 409 del endpoint). */
export async function razonSinLease(
  entityId: string,
  userId: string
): Promise<AppError> {
  const fila = await obtenerTicket(entityId, userId)
  if (!fila) {
    return new AppError(404, "not_found", "Ticket no encontrado")
  }
  const estado = fila.doc.state?.current
  const conDatos = fila.doc.dynamicProperties?.[TICKET_KEYS.datos] != null
  if (estado !== "draft" || conDatos) {
    return new AppError(
      409,
      "extraccion_no_aplicable",
      "Este ticket ya tiene datos extraídos. Corrígelos desde la revisión o guarda los cambios.",
    )
  }
  if (fila.scanStatus === "processing") {
    return new AppError(
      409,
      "analisis_en_curso",
      "Ya hay un análisis en curso para este ticket. Espera el resultado o reintenta en unos minutos.",
    )
  }
  if (fila.scanStatus === "succeeded") {
    return new AppError(
      409,
      "analisis_sin_datos",
      "El análisis terminó sin datos utilizables. Corrige el ticket a mano y confírmalo.",
    )
  }
  return new AppError(
    409,
    "extraccion_no_aplicable",
    "Este ticket no admite un nuevo análisis en su estado actual.",
  )
}

export interface ResultadoScanParams {
  userId: string
  datos: DatosTicket | null
  advertencias: string[]
  modelo: string
  intento: number
}

export interface DocActualizado {
  doc: UmeJson
  version: number
}

/**
 * Aplica el resultado exitoso del análisis: guarda datos/advertencias/
 * metadatos en el documento, mueve draft → validation_required y deja el
 * evento `imported.from` en el journal. Un intento obsoleto (vencido y
 * reemplazado) se descarta sin tocar nada. Sin datos (imagen que no es
 * ticket) el ticket queda guardado con su foto y el aviso, nunca una compra
 * inventada.
 */
export async function guardarResultadoScan(
  entityId: string,
  params: ResultadoScanParams
): Promise<DocActualizado> {
  return withTransaction(async (client) => {
    const intento = await client.query(
      "SELECT scan_attempt FROM tickets WHERE entity_id = $1 AND user_id = $2 FOR UPDATE",
      [entityId, params.userId]
    )
    if (!intento.rowCount) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }
    if (Number(intento.rows[0].scan_attempt) !== params.intento) {
      throw new AppError(
        409,
        "intento_obsoleto",
        "El resultado del análisis quedó obsoleto; ya se registró otro intento.",
      )
    }

    const actual = await client.query(
      "SELECT doc, version FROM entities WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [entityId]
    )
    if (!actual.rowCount) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }
    const doc = actual.rows[0].doc as UmeJson
    if (doc.dynamicProperties?.[TICKET_KEYS.datos] != null) {
      throw new AppError(
        409,
        "datos_ya_presentes",
        "El ticket ya tiene datos; no se sobrescriben con un análisis tardío.",
      )
    }

    const occurredAt = new Date().toISOString()
    const actor = `user:${params.userId}`
    const newDoc = structuredClone(doc)
    newDoc.dynamicProperties[TICKET_KEYS.datos] = params.datos
    newDoc.dynamicProperties[TICKET_KEYS.advertencias] = params.advertencias
    newDoc.dynamicProperties[TICKET_KEYS.extraccion] = {
      modelo: params.modelo,
      fecha: occurredAt,
      intento: params.intento,
    }
    if (newDoc.state.current === "draft") {
      newDoc.state.current = "validation_required"
      newDoc.state.statusLog = [
        ...(newDoc.state.statusLog ?? []),
        {
          status: "validation_required",
          timestamp: occurredAt,
          reason: "Extracción automática de la foto",
        },
      ].slice(-20)
    }
    newDoc.lifecycle.updatedAt = occurredAt
    const nuevaVersion = (actual.rows[0].version as number) + 1
    newDoc.lifecycle.version = nuevaVersion

    await client.query(
      `UPDATE entities
          SET doc = $2::jsonb, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $3`,
      [entityId, JSON.stringify(newDoc), actual.rows[0].version]
    )

    const seqResult = await client.query(
      "SELECT coalesce(max(seq), 0) + 1 AS seq FROM entity_events WHERE entity_id = $1",
      [entityId]
    )
    await client.query(
      `INSERT INTO entity_events
         (entity_id, seq, event_type, payload, actor, reason, occurred_at)
       VALUES ($1, $2, 'imported.from', $3::jsonb, $4, $5, $6::timestamptz)`,
      [
        entityId,
        seqResult.rows[0].seq,
        JSON.stringify({
          via: "ticket_scan",
          modelo: params.modelo,
          intento: params.intento,
        }),
        actor,
        "Extracción automática de la foto",
        occurredAt,
      ]
    )

    await client.query(
      `UPDATE tickets
          SET scan_status = 'succeeded', scan_lease_until = NULL,
              scan_error = NULL, updated_at = now()
        WHERE entity_id = $1 AND scan_attempt = $2`,
      [entityId, params.intento]
    )

    return { doc: newDoc, version: nuevaVersion }
  })
}

/** Registra un fallo del análisis (mensaje seguro, sin datos sensibles). */
export async function guardarErrorScan(
  entityId: string,
  userId: string,
  mensaje: string,
  intento: number
): Promise<void> {
  await withTransaction((client) =>
    client.query(
      `UPDATE tickets
          SET scan_status = 'failed',
              scan_error = left($3, 300),
              scan_lease_until = NULL,
              updated_at = now()
        WHERE entity_id = $1 AND user_id = $2 AND scan_attempt = $4`,
      [entityId, userId, mensaje, intento]
    )
  )
}

export interface ActualizarTicketParams {
  userId: string
  expectedVersion: number
  /** Datos corregidos por el usuario (ya validados por el dominio). */
  datos?: DatosTicket
  confirmar: boolean
  actor: string
}

/**
 * Corrección y confirmación del propietario, atómicas con compare-and-swap
 * por `version`. Confirmar exige encabezado y total conocidos. Corregir un
 * ticket confirmado lo devuelve a revisión. Escribe los eventos del journal
 * sin publicar al bus (privacidad).
 */
export async function actualizarTicket(
  entityId: string,
  params: ActualizarTicketParams
): Promise<DocActualizado> {
  return withTransaction(async (client) => {
    const actual = await client.query(
      `SELECT e.doc, e.version
         FROM entities e
         JOIN tickets t ON t.entity_id = e.id
        WHERE e.id = $1 AND t.user_id = $2 AND e.deleted_at IS NULL
        FOR UPDATE OF e`,
      [entityId, params.userId]
    )
    if (!actual.rowCount) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }
    const doc = actual.rows[0].doc as UmeJson
    const versionActual = actual.rows[0].version as number
    if (versionActual !== params.expectedVersion) {
      throw new AppError(
        409,
        "version_conflict",
        "El ticket cambió en otro dispositivo o pestaña. Recárgalo y vuelve a aplicar.",
      )
    }

    const occurredAt = new Date().toISOString()
    const newDoc = structuredClone(doc)
    const props = newDoc.dynamicProperties
    let cambioDatos = false
    if (params.datos !== undefined) {
      cambioDatos =
        JSON.stringify(props[TICKET_KEYS.datos]) !== JSON.stringify(params.datos)
      if (cambioDatos) props[TICKET_KEYS.datos] = params.datos
    }

    const estadoAntes = newDoc.state.current
    let cambioEstado = false

    if (params.confirmar) {
      const faltantes = camposFaltantesParaConfirmar(
        (props[TICKET_KEYS.datos] as DatosTicket | null) ?? null
      )
      if (faltantes.length > 0) {
        throw new AppError(
          422,
          "confirmacion_incompleta",
          `Faltan datos obligatorios para confirmar: ${faltantes.join(", ")}.`,
          { faltantes }
        )
      }
      if (estadoAntes !== "active" || cambioDatos) {
        props[TICKET_KEYS.revisadoAt] = occurredAt
        if (estadoAntes !== "active") {
          newDoc.state.current = "active"
          newDoc.state.statusLog = [
            ...(newDoc.state.statusLog ?? []),
            {
              status: "active",
              timestamp: occurredAt,
              reason: "Confirmado por el propietario",
            },
          ].slice(-20)
          cambioEstado = true
        }
      }
    } else if (estadoAntes === "active" && cambioDatos) {
      // Corregir un confirmado lo devuelve a revisión.
      delete props[TICKET_KEYS.revisadoAt]
      newDoc.state.current = "validation_required"
      newDoc.state.statusLog = [
        ...(newDoc.state.statusLog ?? []),
        {
          status: "validation_required",
          timestamp: occurredAt,
          reason: "Corrección del propietario",
        },
      ].slice(-20)
      cambioEstado = true
    }

    if (!cambioDatos && !cambioEstado) {
      throw new AppError(
        422,
        "no_changes",
        "No hay cambios que guardar.",
      )
    }

    newDoc.lifecycle.updatedAt = occurredAt
    const nuevaVersion = versionActual + 1
    newDoc.lifecycle.version = nuevaVersion

    await client.query(
      `UPDATE entities
          SET doc = $2::jsonb, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $3`,
      [entityId, JSON.stringify(newDoc), versionActual]
    )

    let seq = Number(
      (
        await client.query(
          "SELECT coalesce(max(seq), 0) AS seq FROM entity_events WHERE entity_id = $1",
          [entityId]
        )
      ).rows[0].seq
    )

    if (cambioDatos) {
      seq += 1
      await client.query(
        `INSERT INTO entity_events
           (entity_id, seq, event_type, payload, actor, reason, occurred_at)
         VALUES ($1, $2, 'property.updated', $3::jsonb, $4, $5, $6::timestamptz)`,
        [
          entityId,
          seq,
          JSON.stringify({
            diff: {
              [TICKET_KEYS.datos]: { to: "(datos corregidos por el propietario)" },
            },
          }),
          params.actor,
          "Corrección manual del ticket",
          occurredAt,
        ]
      )
    }
    if (cambioEstado) {
      seq += 1
      await client.query(
        `INSERT INTO entity_events
           (entity_id, seq, event_type, payload, actor, reason, occurred_at)
         VALUES ($1, $2, 'state.changed', $3::jsonb, $4, $5, $6::timestamptz)`,
        [
          entityId,
          seq,
          JSON.stringify({ from: estadoAntes, to: newDoc.state.current }),
          params.actor,
          params.confirmar
            ? "Confirmación del propietario"
            : "Corrección de un ticket confirmado",
          occurredAt,
        ]
      )
    }

    return { doc: newDoc, version: nuevaVersion }
  })
}

/** Reservado: el nombre solo lo crea el módulo (con foto y control). */
export function errorNombreReservado(): AppError {
  return new AppError(
    403,
    "reserved_entity_name",
    `Entity name '${ENTITY_NAME_TICKET}' is reserved for the tickets module`,
  )
}

/** Utilidad compartida: scope de propiedad estricta sobre un doc de ticket. */
export function assertPropietarioTicket(doc: UmeJson, userId: string): void {
  const owner = doc.dynamicProperties?.distribuidorId
  if (doc.entityName === ENTITY_NAME_TICKET && owner !== userId) {
    throw new AppError(404, "not_found", "Entity does not exist")
  }
}
