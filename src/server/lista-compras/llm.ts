import { z } from "zod"

import {
  MAX_OPS,
  MAX_TEXTO_INTERPRETE,
  aplicarOperaciones,
  requiereConfirmacion,
  validarOperacion,
  type ItemLista,
  type Operacion,
  type SnapshotLista,
} from "@/lib/lista-compras"
import { AppError } from "@/server/umejson/types"

/*
 * Interpretación de la instrucción escrita o dictada con un LLM vía
 * OpenRouter (misma clave y patrón que el Asistente de soporte). Es un paso
 * de solo lectura: recibe la instrucción y un snapshot compacto de la lista,
 * y devuelve operaciones acotadas o una aclaración. Nunca escribe la base ni
 * recibe credenciales, identidad del usuario o historial de otros módulos.
 *
 * La salida se valida con Zod y con los validadores estrictos del dominio:
 * IDs desconocidos, operaciones sin sentido o salidas malformadas se
 * descartan con aviso en lugar de aplicarse a medias.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimitInterpretar(userId: string): boolean {
  const now = Date.now()
  if (rateBuckets.size > 1000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key)
    }
  }
  const bucket = rateBuckets.get(userId)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT_MAX
}

export function limpiarTextoInterprete(input: unknown): string | null {
  if (typeof input !== "string") return null
  const texto = input.trim()
  if (!texto || texto.length > MAX_TEXTO_INTERPRETE) return null
  return texto
}

/** Snapshot compacto para el prompt: IDs estables para referencias. */
function snapshotAPrompt(items: ItemLista[]): string {
  if (items.length === 0) return "(la lista está vacía)"
  return items
    .slice(0, 200)
    .map((item) => {
      const partes = [`[${item.id}] ${item.nombre}`, item.categoria]
      if (item.cantidad !== null) {
        partes.push(item.unidad ? `${item.cantidad} ${item.unidad}` : String(item.cantidad))
      } else {
        partes.push("sin cantidad")
      }
      partes.push(item.comprado ? "comprado" : "pendiente")
      if (item.estimado) partes.push("estimado")
      return `- ${partes.join(" — ")}`
    })
    .join("\n")
}

function buildSystemPrompt(): string {
  return [
    "Eres el intérprete del módulo Lista de compras del panel Distribuidor TVBox.",
    "Recibes la instrucción del usuario (escrita o dictada) y el estado actual de SU lista de compras.",
    "Devuelves EXCLUSIVAMENTE un objeto JSON con esta forma: {\"aclaracion\": string|null, \"operaciones\": [..]}.",
    "\"operaciones\" es una lista con cero o más de estas operaciones:",
    '{"tipo":"agregar","nombre":string,"categoria":string,"cantidad":number|null,"unidad":string|null,"estimado":boolean,"suma":boolean}',
    '{"tipo":"actualizar","id":string,"nombre":string?,"categoria":string?,"cantidad":number?,"modoCantidad":"establecer"|"sumar","unidad":string|null?,"estimado":boolean?}',
    '{"tipo":"eliminar","id":string}',
    '{"tipo":"marcar","id":string,"comprado":boolean}',
    '{"tipo":"reemplazar","items":[{"nombre":string,"categoria":string,"cantidad":number|null,"unidad":string|null,"estimado":boolean}]}',
    '{"tipo":"vaciar"}',
    "Reglas obligatorias:",
    "1. Usa EXACTAMENTE estos nombres de campo, sin sinónimos: tipo, nombre (nunca \"producto\"), categoria, cantidad, unidad, estimado, suma, id, comprado, items, modoCantidad, aclaracion, operaciones.",
    "1. Sé fiel al pedido: NUNCA inventes productos ni cantidades que el usuario no mencionó ni pidio estimar. Sin cantidad indicada usa cantidad null y unidad null.",
    "2. Categorías válidas (usa exactamente una): Frutas y verduras; Carnes y pescados; Lácteos y huevos; Panadería y tortillería; Despensa; Bebidas; Congelados; Limpieza; Higiene y cuidado personal; Mascotas; Otros. Si dudas usa Otros.",
    "3. Unidades válidas (singular): g, kg, ml, l, pza, paquete, caja, bolsa, docena, lata, sobre, botella. Convierte unidades coherentes antes de responder (ej. 500 ml más 1 l = 1.5 l).",
    "4. Para modificar o quitar un producto existente usa SU id entre corchetes del estado. Si el usuario menciona un producto ambiguo o inexistente en la lista, no adivines: pon una aclaración y cero operaciones.",
    "5. «agrega X» de algo que ya está: responde agregar con el MISMO nombre (el sistema no duplica); agrega \"suma\": true solo cuando el usuario pide aumentar la cantidad («agrega otros 2», «pone 3 más»). «cambia a 3» o «deja 3» es actualizar con modoCantidad \"establecer\".",
    "6. «ya compré X» o «tacha X» es marcar comprado true; «faltan X» o «no compré X» es marcar false.",
    "7. «nueva lista con ...» o «haz una lista de ...» es reemplazar con los ítems completos (estimación de cantidades/productos SOLO si el usuario lo pide, ej. «para una cena de 4»; marca estimado true lo estimado). «limpiar lista» o «borra toda la lista» es vaciar.",
    "8. «quita el pan» o «borra la leche» es eliminar por id.",
    "9. No sumes unidades incompatibles ni fusiles variantes distintas (torta de chocolate y torta de vainilla son productos distintos). Un agregar a un producto ya comprado lo regresa a pendiente (el sistema lo hace).",
    "10. Si la instrucción no tiene sentido, no es sobre la lista, o no hay nada que hacer, responde con aclaracion (texto breve en español) y cero operaciones.",
    "11. La aclaración también sirve para avisos breves (ej. «agregué 2 kg de tomate a Frutas y verduras»); máximo una oración.",
    "Responde SIEMPRE en español y SOLO el objeto JSON, sin markdown ni texto extra.",
  ].join(" ")
}

const respuestaSchema = z.object({
  aclaracion: z.string().max(500).nullish(),
  operaciones: z.array(z.unknown()).max(MAX_OPS).nullish(),
})

const CIERRES = ["```json", "```"] as const

function extraerJson(texto: string): unknown {
  let clean = texto.trim()
  if (clean.startsWith("```")) {
    for (const cierre of CIERRES) {
      if (clean.startsWith(cierre)) {
        clean = clean.slice(cierre.length)
        break
      }
    }
    const fin = clean.lastIndexOf("```")
    if (fin >= 0) clean = clean.slice(0, fin)
    clean = clean.trim()
  }
  try {
    return JSON.parse(clean)
  } catch {
    // Algunos modelos meten texto alrededor del objeto: se recorta del
    // primer "{" al último "}" y se reintenta.
    const inicio = clean.indexOf("{")
    const fin = clean.lastIndexOf("}")
    if (inicio >= 0 && fin > inicio) {
      try {
        return JSON.parse(clean.slice(inicio, fin + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export interface ResultadoInterpretacion {
  aclaracion: string | null
  ops: Operacion[]
  requiereConfirmacion: boolean
  revision: number
}

/**
 * Interpreta la instrucción contra el snapshot actual. Falla con errores
 * claros si el proveedor o el modelo no están configurados, si se agota el
 * tiempo o si la salida no es utilizable: en ese caso el cliente conserva su
 * borrador y la lista no cambia (la escritura real ocurre en el PATCH).
 */
export async function interpretarInstruccion(
  userId: string,
  texto: string,
  snapshot: SnapshotLista,
  signal?: AbortSignal
): Promise<ResultadoInterpretacion> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.LISTA_COMPRAS_MODEL ?? process.env.ASISTENTE_MODEL
  if (!apiKey || !model) {
    throw new AppError(
      500,
      "llm_not_configured",
      "La interpretación no está configurada en el servidor (falta OPENROUTER_API_KEY o el modelo)."
    )
  }

  const userContent = [
    `Instrucción del usuario: "${texto}"`,
    "Estado actual de la lista:",
    snapshotAPrompt(snapshot.items),
  ].join("\n")

  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  if (signal?.aborted) upstreamAbort.abort()
  else signal?.addEventListener("abort", onClientAbort, { once: true })
  const timeout = setTimeout(() => upstreamAbort.abort(), 30_000)
  timeout.unref?.()

  let upstream: Response
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: upstreamAbort.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        // Holgado a propósito: el modelo del asistente razona antes de
        // responder y agota presupuestos cortos sin emitir contenido.
        max_tokens: 3000,
        response_format: { type: "json_object" },
        // El razonamiento viene cifrado aparte; excluirlo deja el contenido
        // limpio y evita gastar tokens de salida en texto que no se usa.
        reasoning: { exclude: true },
      }),
    })
  } catch {
    throw new AppError(
      504,
      "llm_timeout",
      "La interpretación tardó demasiado. Intenta de nuevo."
    )
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", onClientAbort)
  }

  if (!upstream.ok) {
    throw new AppError(
      502,
      "llm_error",
      "El servicio de interpretación no respondió bien. Intenta de nuevo en un momento."
    )
  }

  let payload: unknown
  try {
    payload = await upstream.json()
  } catch {
    throw new AppError(502, "llm_error", "Respuesta no utilizable del servicio.")
  }
  const contenido = (
    payload as {
      choices?: { message?: { content?: unknown } }[]
    }
  )?.choices?.[0]?.message?.content
  if (typeof contenido !== "string" || !contenido.trim()) {
    throw new AppError(502, "llm_error", "El modelo no devolvió contenido.")
  }

  const parsed = respuestaSchema.safeParse(extraerJson(contenido))
  if (!parsed.success) {
    throw new AppError(
      502,
      "llm_salida_invalida",
      "No pude interpretar la respuesta. Reformula tu petición."
    )
  }

  const aclaracionLLM =
    typeof parsed.data.aclaracion === "string" && parsed.data.aclaracion.trim()
      ? parsed.data.aclaracion.trim()
      : null

  // IDs válidos solo contra el snapshot real: una referencia desconocida
  // tira la operación y se avisa, nunca se aplica a medias. Cada op cruda
  // del modelo pasa por el validador estricto del dominio antes de usarse.
  const idsValidos = new Set(snapshot.items.map((item) => item.id))
  const ops: Operacion[] = []
  let descartadas = 0
  for (const raw of parsed.data.operaciones ?? []) {
    if (raw && typeof raw === "object") {
      const tipo = (raw as Record<string, unknown>).tipo
      if (
        (tipo === "actualizar" ||
          tipo === "eliminar" ||
          tipo === "marcar") &&
        (typeof (raw as Record<string, unknown>).id !== "string" ||
          !idsValidos.has((raw as Record<string, unknown>).id as string))
      ) {
        descartadas += 1
        continue
      }
    }
    const op = validarOperacion(raw)
    if (op) ops.push(op)
    else descartadas += 1
  }

  // Ensayo de solo lectura contra el snapshot: detecta sumas con unidades
  // incompatibles u otras combinaciones sin sentido antes de proponer nada.
  const resultado = aplicarOperaciones(snapshot.items, ops)
  if (!resultado.ok) {
    throw new AppError(422, "operaciones_invalidas", resultado.razon, {
      snapshot,
    })
  }

  let aclaracion = aclaracionLLM
  if (descartadas > 0) {
    const aviso =
      descartadas === 1
        ? "No encontré uno de los productos mencionados en la lista actual."
        : `No encontré ${descartadas} de los productos mencionados en la lista actual.`
    aclaracion = aclaracion ? `${aclaracion} ${aviso}` : aviso
  }

  return {
    aclaracion,
    ops,
    requiereConfirmacion: requiereConfirmacion(snapshot.items, ops),
    revision: snapshot.revision,
  }
}
