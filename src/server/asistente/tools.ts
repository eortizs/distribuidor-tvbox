import { EXPENSE_CATEGORIES } from "@/lib/finanzas"
import {
  createExpense,
  listExpenses,
  summarizeExpenses,
  validateExpenseInput,
} from "@/server/finanzas/gastos"
import { AppError } from "@/server/umejson/types"

/*
 * Data tools for the assistant. The session user id is injected server-side on
 * every execution, so the model can never read or write another user's
 * expenses: tool arguments only ever carry expense data, never identity.
 */

const DAY_DESC =
  "Fecha del gasto en formato YYYY-MM-DD (calendario de Ciudad de México). Resuelve fechas relativas con la fecha actual del sistema."

export const ASSISTANT_TOOLS = [
  {
    type: "function",
    function: {
      name: "registrar_gasto",
      description:
        "Registra un gasto del usuario. Úsala cuando el usuario pida anotar, registrar o guardar un gasto. Devuelve el gasto guardado con su equivalente en MXN.",
      parameters: {
        type: "object",
        properties: {
          descripcion: {
            type: "string",
            maxLength: 300,
            description: "Descripción breve del gasto (ej. 'Compra de 10 TVBox').",
          },
          categoria: {
            type: "string",
            enum: [...EXPENSE_CATEGORIES],
            description: "Categoría del gasto. Si el usuario no la indica, infiere la más adecuada.",
          },
          monto: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Monto del gasto, mayor a 0.",
          },
          moneda: {
            type: "string",
            enum: ["MXN", "USD"],
            description: "Moneda en que se pagó el gasto.",
          },
          fecha: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: DAY_DESC,
          },
          notas: {
            type: "string",
            maxLength: 1000,
            description: "Notas opcionales (proveedor, método de pago, contexto).",
          },
        },
        required: ["descripcion", "categoria", "monto", "moneda", "fecha"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_gastos",
      description:
        "Consulta los gastos del usuario con filtros opcionales. Devuelve la lista de gastos con montos, monedas y equivalentes en MXN.",
      parameters: {
        type: "object",
        properties: {
          desde: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: `Fecha inicial del rango (inclusive). ${DAY_DESC}`,
          },
          hasta: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: `Fecha final del rango (inclusive). ${DAY_DESC}`,
          },
          categoria: {
            type: "string",
            enum: [...EXPENSE_CATEGORIES],
            description: "Filtra por una sola categoría.",
          },
          texto: {
            type: "string",
            maxLength: 100,
            description: "Texto a buscar dentro de la descripción o notas.",
          },
          limite: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Cantidad máxima de gastos a devolver (por defecto 20).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resumen_gastos",
      description:
        "Genera el resumen (estado de cuenta) de gastos del usuario en un periodo: total en MXN, desglose por categoría y por mes, y USD pendiente de conversión. Úsala para reportes, totales y cálculos del estado de cuenta.",
      parameters: {
        type: "object",
        properties: {
          desde: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: `Inicio del periodo (inclusive). Por defecto, el 1 de enero del año en curso. ${DAY_DESC}`,
          },
          hasta: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: `Fin del periodo (inclusive). Por defecto, hoy. ${DAY_DESC}`,
          },
        },
        additionalProperties: false,
      },
    },
  },
] as const

type ToolCallArgs = Record<string, unknown>

function defaultSummaryRange(): { desde: string; hasta: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  return { desde: `${today.slice(0, 4)}-01-01`, hasta: today }
}

/*
 * Models occasionally echo an argument under its English alias even though
 * the schema declares Spanish names; accept both instead of failing the call.
 */
function pickArg(args: ToolCallArgs, key: string, ...aliases: string[]): unknown {
  if (args[key] !== undefined) return args[key]
  for (const alias of aliases) {
    if (args[alias] !== undefined) return args[alias]
  }
  return undefined
}

function normalizeArgs(args: ToolCallArgs): ToolCallArgs {
  return {
    description: pickArg(args, "descripcion", "description"),
    category: pickArg(args, "categoria", "category"),
    amount: pickArg(args, "monto", "amount"),
    currency: pickArg(args, "moneda", "currency"),
    spentOn: pickArg(args, "fecha", "date", "spentOn"),
    notes: pickArg(args, "notas", "notes"),
  }
}

async function registrarGasto(args: ToolCallArgs, userId: string) {
  const expense = await createExpense(
    userId,
    validateExpenseInput(normalizeArgs(args)),
    "asistente"
  )
  return {
    ok: true,
    gasto: {
      id: expense.id,
      descripcion: expense.description,
      categoria: expense.category,
      monto: expense.amount,
      moneda: expense.currency,
      fecha: expense.spentOn,
      notas: expense.notes,
      tipo_cambio: expense.exchangeRate,
      equivalente_mxn: expense.mxnEquivalent,
    },
  }
}

async function consultarGastos(args: ToolCallArgs, userId: string) {
  const normalized = {
    desde: pickArg(args, "desde", "from"),
    hasta: pickArg(args, "hasta", "to"),
    categoria: pickArg(args, "categoria", "category"),
    texto: pickArg(args, "texto", "query", "q"),
    limite: pickArg(args, "limite", "limit"),
  }
  const limiteRaw = Number(normalized.limite ?? 20)
  const result = await listExpenses(userId, {
    from: typeof normalized.desde === "string" ? normalized.desde : undefined,
    to: typeof normalized.hasta === "string" ? normalized.hasta : undefined,
    category: typeof normalized.categoria === "string" ? normalized.categoria : undefined,
    q: typeof normalized.texto === "string" ? normalized.texto : undefined,
    limit: Number.isFinite(limiteRaw) ? limiteRaw : 20,
  })
  return {
    ok: true,
    total_encontrados: result.total,
    devueltos: result.items.length,
    gastos: result.items.map((expense) => ({
      id: expense.id,
      descripcion: expense.description,
      categoria: expense.category,
      monto: expense.amount,
      moneda: expense.currency,
      fecha: expense.spentOn,
      notas: expense.notes,
      tipo_cambio: expense.exchangeRate,
      equivalente_mxn: expense.mxnEquivalent,
    })),
  }
}

async function resumenGastos(args: ToolCallArgs, userId: string) {
  const defaults = defaultSummaryRange()
  const desde = pickArg(args, "desde", "from")
  const hasta = pickArg(args, "hasta", "to")
  const summary = await summarizeExpenses(userId, {
    from: typeof desde === "string" ? desde : defaults.desde,
    to: typeof hasta === "string" ? hasta : defaults.hasta,
  })
  return {
    ok: true,
    periodo: { desde: summary.from, hasta: summary.to },
    cantidad_gastos: summary.count,
    total_mxn: summary.totalMxn,
    usd_pendiente_conversion: {
      monto_usd: summary.usdPending,
      cantidad: summary.usdPendingCount,
      nota:
        summary.usdPendingCount > 0
          ? "Estos gastos en USD se registraron sin tipo de cambio disponible; no están incluidos en total_mxn."
          : null,
    },
    por_categoria: summary.byCategory.map((bucket) => ({
      categoria: bucket.key,
      cantidad: bucket.count,
      total_mxn: bucket.totalMxn,
      usd_pendiente: bucket.usdPending,
    })),
    por_mes: summary.byMonth.map((bucket) => ({
      mes: bucket.key,
      cantidad: bucket.count,
      total_mxn: bucket.totalMxn,
      usd_pendiente: bucket.usdPending,
    })),
  }
}

const TOOL_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("La operación de datos tardó demasiado.")),
      TOOL_TIMEOUT_MS
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export interface AssistantToolCall {
  id: string
  name: string
  arguments: string
}

/*
 * Executes one tool call. Errors are returned as JSON payloads (never thrown)
 * so the model can explain the problem to the user instead of breaking the
 * turn. Identity comes exclusively from the authenticated session.
 */
export async function executeAssistantTool(
  call: AssistantToolCall,
  userId: string
): Promise<string> {
  let args: ToolCallArgs = {}
  try {
    const parsed = JSON.parse(call.arguments || "{}") as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Argumentos inválidos")
    }
    args = parsed as ToolCallArgs
  } catch {
    return JSON.stringify({
      ok: false,
      error: "Los argumentos de la herramienta no son un objeto JSON válido.",
    })
  }

  try {
    switch (call.name) {
      case "registrar_gasto":
        return JSON.stringify(await withTimeout(registrarGasto(args, userId)))
      case "consultar_gastos":
        return JSON.stringify(await withTimeout(consultarGastos(args, userId)))
      case "resumen_gastos":
        return JSON.stringify(await withTimeout(resumenGastos(args, userId)))
      default:
        return JSON.stringify({
          ok: false,
          error: `Herramienta desconocida: ${call.name}.`,
        })
    }
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "No se pudo completar la operación de datos. Inténtalo de nuevo."
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `asistente: tool ${call.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
    return JSON.stringify({ ok: false, error: message })
  }
}
