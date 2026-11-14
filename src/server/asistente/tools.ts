import { EXPENSE_CATEGORIES } from "@/lib/finanzas"
import { isRenewalMonths } from "@/lib/flujotv"
import type { FlujoClient, RenewalMonths } from "@/lib/flujotv"
import { foldTerm, formatFlujoDate } from "@/lib/flujotv"
import {
  isPaqueteMonths,
  PAQUETE_COUPON_CODE,
  PAQUETES,
  paqueteBonusMonths,
} from "@/lib/paquetes"
import type { PaqueteMonths } from "@/lib/paquetes"
import { getAccountDistribuidorName } from "@/server/auth/accounts"
import type { AuthUser, UserRole } from "@/server/auth/types"
import { pool } from "@/server/db"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { FlujoApiError } from "@/server/flujotv/errors"
import {
  fetchFlujoClientNames,
  getFlujoClient,
  getFlujoUserResellers,
  listFlujoClients,
} from "@/server/flujotv/service"
import {
  clientDistributor,
  isFlujoClientInScope,
  resolveClientScope,
  scopeFlujoClients,
} from "@/server/flujotv/scope"
import {
  createExpense,
  listExpenses,
  summarizeExpenses,
  validateExpenseInput,
} from "@/server/finanzas/gastos"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import { isCouponQaEnabled, licensePriceMxnOrNull } from "@/server/mercadopago/config"
import { createCouponOrder, getMpOrder } from "@/server/mercadopago/service"
import { getSaldosActual } from "@/server/saldo/service"
import { listarVista } from "@/server/tickets/service"
import { AppError } from "@/server/umejson/types"

/*
 * Data tools for the assistant. The session user id is injected server-side on
 * every execution, so the model can never read or write another user's
 * expenses: tool arguments only ever carry expense data, never identity.
 *
 * Business tools (saldos, clientes FlujoTV, vencimientos, tickets, paquetes,
 * órdenes y renovaciones pagadas con cupones) comparten esta capa con el
 * agente de WhatsApp: misma validación, mismo alcance (el distribuidor solo
 * ve/opera sus clientes) y errores como JSON para el modelo. El canje de
 * renovaciones exige confirmación explícita (`confirmar: true`) y usa el
 * mismo guard de alcance y la misma createCouponOrder idempotente que las
 * rutas HTTP.
 */

const DAY_DESC =
  "Fecha del gasto en formato YYYY-MM-DD (calendario de Ciudad de México). Resuelve fechas relativas con la fecha actual del sistema."

/** Presupuesto propio de las tools para la guarda de alcance contra el panel. */
const TOOL_FLUJO_TIMEOUT_MS = 15_000

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
  {
    type: "function",
    function: {
      name: "consultar_saldos",
      description:
        "Consulta el saldo vigente de la cuenta: pesos en cupones (billetera para renovaciones de licencias FlujoTV) y en tokens (herramientas con APIs de pago).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_clientes",
      description:
        "Busca clientes de FlujoTV del alcance de la cuenta con la MISMA fuente y campos que el módulo Clientes de la app (los mismos que ve en la GUI). Sin filtro devuelve los primeros del listado; con filtro busca por usuario, correo o nombre. Cada cliente viene con la tarjeta completa de la GUI: usuario, nombre, correo, estado, dias_restantes y dias_compacto («13d», «—» sin dato), vence ya formateado («13 nov 2026»), socio y plan. Para responder «¿cuándo vence X?» cita exactamente: vence <vence> (<dias_compacto>) y, si existe, socio: <socio>.",
      parameters: {
        type: "object",
        properties: {
          filtro: {
            type: "string",
            maxLength: 80,
            description:
              "Texto de búsqueda opcional (usuario, correo o nombre; sin acentos también coincide).",
          },
          limite: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Cantidad máxima de clientes a devolver (por defecto 20).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proximos_vencimientos",
      description:
        "Lista los clientes de FlujoTV del alcance de la cuenta que vencen en los próximos N días (default 7; acepta 1 a 90), el más próximo primero. Cada cliente trae la misma tarjeta que el módulo Clientes: usuario, nombre, estado, dias_compacto («13d»), vence ya formateado («13 nov 2026»), socio y plan.",
      parameters: {
        type: "object",
        properties: {
          dias: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            description: "Ventana en días (por defecto 7).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_tickets",
      description:
        "Lista los tickets de compra (Altas de tickets) de la cuenta con su estado de revisión y los datos extraídos (comercio, fecha, total).",
      parameters: {
        type: "object",
        properties: {
          estado: {
            type: "string",
            enum: ["borrador", "revision", "confirmado"],
            description: "Filtra por estado; sin filtro devuelve todos.",
          },
          limite: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Cantidad máxima de tickets a devolver (por defecto 10).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_paquetes",
      description:
        "Catálogo de paquetes de renovación FlujoTV (3, 6 y 12 meses con meses gratis) y su precio en MXN pagado con cupón. Úsala para informar costos de paquetes.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ultimas_ordenes",
      description:
        "Lista las últimas órdenes de pago/renovación de esta cuenta (Mercado Pago, transferencia, cupón y abonos de saldo), la más nueva primero.",
      parameters: {
        type: "object",
        properties: {
          limite: {
            type: "integer",
            minimum: 1,
            maximum: 15,
            description: "Cantidad máxima de órdenes a devolver (por defecto 8).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estado_orden",
      description:
        "Consulta el estado detallado de una orden propia por su id: pago, renovación (en curso, aplicada o fallida), meses y monto. Úsala para saber si una renovación ya se aplicó.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "Id de la orden (el que devolvió canjear_renovacion o ultimas_ordenes).",
          },
        },
        required: ["order_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cotizar_renovacion",
      description:
        "Cotiza una renovación de licencia FlujoTV pagada con cupones: valida que el cliente esté en tu alcance, calcula el costo en MXN y lo compara con el saldo en cupones. NO gasta nada: siempre cotiza antes de canjear.",
      parameters: {
        type: "object",
        properties: {
          user_name: {
            type: "string",
            maxLength: 100,
            description: "Usuario de la licencia FlujoTV a renovar.",
          },
          months: {
            type: "integer",
            enum: [1, 3, 6, 12],
            description: "Meses a pagar (paquete: solo 3, 6 o 12, con meses gratis).",
          },
          paquete: {
            type: "boolean",
            description:
              "true = canje como paquete (3/6/12 meses + meses gratis, cupón 1010); false u omitido = renovación individual.",
          },
        },
        required: ["user_name", "months"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "canjear_renovacion",
      description:
        "Ejecuta una renovación de licencia FlujoTV debitando el saldo en cupones de la cuenta. Requiere confirmar=true y SOLO se llama después de cotizar y de que el usuario confirme explícitamente en el chat. La renovación se aplica en segundo plano; devuelve el id de la orden para seguimiento con estado_orden.",
      parameters: {
        type: "object",
        properties: {
          user_name: {
            type: "string",
            maxLength: 100,
            description: "Usuario de la licencia FlujoTV a renovar.",
          },
          months: {
            type: "integer",
            enum: [1, 3, 6, 12],
            description: "Meses a pagar (paquete: solo 3, 6 o 12, con meses gratis).",
          },
          paquete: {
            type: "boolean",
            description:
              "true = canje como paquete (3/6/12 meses + meses gratis); false u omitido = renovación individual.",
          },
          confirmar: {
            type: "boolean",
            description:
              "Debe ser true solo tras confirmación explícita del usuario en el chat después de ver la cotización.",
          },
        },
        required: ["user_name", "months", "confirmar"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mi_perfil",
      description:
        "Datos de la cuenta actual: usuario (correo), perfil (admin o distribuidor), reseller FlujoTV ligado y saldo vigente.",
      parameters: {
        type: "object",
        properties: {},
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

/* ------------------------- Negocio: lecturas ------------------------------ */

/** AuthUser mínimo desde el id de sesión; null si la cuenta ya no existe. */
async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const result = await pool.query<{
    id: string
    username: string
    role: UserRole
  }>("SELECT id, username, role FROM users WHERE id = $1::uuid", [userId])
  const row = result.rows[0]
  return row ? { id: row.id, username: row.username, role: row.role } : null
}

/**
 * Listado de clientes FlujoTV del alcance de la cuenta con el MISMO flujo
 * del módulo /clientes: listado + mapa de nombres (/client_names) en
 * paralelo, alcance aplicado y búsqueda local foldTerm sobre
 * usuario/correo/nombre (la GUI nunca re-consulta el panel por el cuadro de
 * búsqueda).
 */
async function listClientsInScope(
  userId: string
): Promise<{
  clients: Awaited<ReturnType<typeof scopeFlujoClients>>
  total: number | null
  names: Record<string, string>
  userResellers: Record<string, string>
}> {
  const user = await loadAuthUser(userId)
  if (!user) {
    return { clients: [], total: null, names: {}, userResellers: {} }
  }
  const scope = await resolveClientScope(user)
  if (scope.kind === "none") {
    return { clients: [], total: null, names: {}, userResellers: {} }
  }
  const [result, names] = await Promise.all([
    listFlujoClients({ limit: 200 }),
    clientNamesSafe(),
  ])
  const scoped = await scopeFlujoClients(result.clients, scope)
  const userResellers = await getFlujoUserResellers().catch(
    () => ({}) as Record<string, string>
  )
  return {
    clients: scoped,
    total: scope.kind === "all" ? result.total : scoped.length,
    names: names ?? {},
    userResellers,
  }
}

/** Búsqueda del módulo Clientes: usuario, correo o nombre, sin acentos. */
function searchClients(
  clients: Awaited<ReturnType<typeof scopeFlujoClients>>,
  names: Record<string, string>,
  filtro: string
): Awaited<ReturnType<typeof scopeFlujoClients>> {
  const term = foldTerm(filtro)
  if (!term) return clients
  return clients.filter(
    (c) =>
      foldTerm(c.userName).includes(term) ||
      foldTerm(c.email ?? "").includes(term) ||
      foldTerm(names[c.userName.trim().toLowerCase()] ?? "").includes(term)
  )
}

/*
 * Nombre propio de los clientes (columna Notas del panel vía /client_names)
 * y mapa usuario→reseller para el «socio»: las MISMAS fuentes que alimenta
 * la tarjeta de /clientes. Si el panel va lento o falla se degrada a null
 * (la tarjeta del panel también pierde el nombre) sin tirar la consulta.
 */
async function clientNamesSafe(): Promise<Record<string, string> | null> {
  const slow = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 15_000)
    timer.unref?.()
  })
  try {
    const result = await Promise.race([fetchFlujoClientNames(), slow])
    return result?.clientNames ?? null
  } catch {
    return null
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Resumen del cliente con los MISMOS campos y formato de la tarjeta de
 * /clientes: usuario, nombre (mapa /client_names), estado, días («0d»),
 * vence («13 nov 2026», es-MX), socio (distribuidor crudo o mapa) y plan.
 */
function clienteResumen(
  c: FlujoClient,
  names: Record<string, string>,
  userResellers: Record<string, string>
) {
  const usuario = c.userName.trim().toLowerCase()
  return {
    usuario: c.userName,
    nombre: names[usuario] ?? null,
    correo: c.email ?? null,
    estado: c.statusLabel,
    dias_restantes: c.daysRemaining,
    dias_compacto:
      c.daysRemaining === null ? "—" : `${c.daysRemaining}d`,
    vence: formatFlujoDate(c.expiresAt),
    socio: clientDistributor(c, userResellers) || null,
    plan: c.plan ?? null,
  }
}

async function consultarSaldos(userId: string) {
  const saldos = await getSaldosActual(userId)
  return {
    ok: true,
    saldo_cupones: round2(saldos.cupones),
    nota_cupones:
      "Billetera exclusiva para renovaciones de licencias FlujoTV pagadas con cupón.",
    saldo_tokens: round2(saldos.tokens),
  }
}

async function buscarClientes(args: ToolCallArgs, userId: string) {
  const filtro =
    typeof pickArg(args, "filtro", "query", "q") === "string"
      ? String(pickArg(args, "filtro", "query", "q")).trim()
      : ""
  const limiteRaw = Number(pickArg(args, "limite", "limit") ?? 20)
  const limite = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 50) : 20
  const { clients, total, names, userResellers } = await listClientsInScope(userId)
  // Mismo orden del listado plano de la GUI: A→Z por usuario (es).
  const sorted = [...clients].sort((a, b) =>
    a.userName.localeCompare(b.userName, "es")
  )
  const filtered = searchClients(sorted, names, filtro)
  return {
    ok: true,
    filtro: filtro || null,
    total_encontrados: filtered.length,
    total_panel: total,
    clientes: filtered
      .slice(0, limite)
      .map((c) => clienteResumen(c, names, userResellers)),
  }
}

async function proximosVencimientos(args: ToolCallArgs, userId: string) {
  const diasRaw = Number(pickArg(args, "dias", "days") ?? 7)
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(diasRaw, 1), 90) : 7
  const { clients, names, userResellers } = await listClientsInScope(userId)
  const porVencer = clients
    .filter(
      (c) =>
        c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= dias
    )
    .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0))
  return {
    ok: true,
    ventana_dias: dias,
    cantidad: porVencer.length,
    clientes: porVencer
      .slice(0, 50)
      .map((c) => clienteResumen(c, names, userResellers)),
  }
}

async function consultarTickets(args: ToolCallArgs, userId: string) {
  const estado = pickArg(args, "estado", "status")
  const limiteRaw = Number(pickArg(args, "limite", "limit") ?? 10)
  const limite = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 20) : 10
  const { items, total } = await listarVista(userId, {
    estado:
      estado === "borrador" || estado === "revision" || estado === "confirmado"
        ? estado
        : undefined,
    limit: limite,
  })
  return {
    ok: true,
    total_encontrados: total,
    tickets: items.map((t) => ({
      id: t.entityId,
      estado: t.estado,
      scan_estado: t.scanEstado,
      comercio: t.datos?.comercio?.nombre ?? null,
      fecha_ticket: t.datos?.fecha ?? null,
      total: t.datos?.total ?? null,
      folio: t.datos?.folio ?? null,
      confirmable: t.confirmable,
      campos_faltantes: t.camposFaltantes,
      advertencias: t.advertencias.length,
      actualizado: t.updatedAt,
    })),
  }
}

async function consultarPaquetes(userId: string) {
  const price = licensePriceMxnOrNull()
  const saldos = await getSaldosActual(userId)
  return {
    ok: true,
    precio_mes_mxn: price,
    saldo_cupones: round2(saldos.cupones),
    cupon_paquete: PAQUETE_COUPON_CODE,
    paquetes: PAQUETES.map((p) => ({
      meses_pagados: p.months,
      meses_gratis: paqueteBonusMonths(p.months),
      meses_totales: p.months + paqueteBonusMonths(p.months),
      precio_mxn: price === null ? null : round2(price * p.months),
    })),
    nota:
      price === null
        ? "El precio de la licencia no está configurado en el servidor."
        : null,
  }
}

const ORDENES_SQL = `SELECT id, user_name, status, method, months, bonus_months, amount, currency, error, created_at, renewed_at
   FROM mp_orders
  WHERE buyer_user_id = $1::uuid
  ORDER BY created_at DESC
  LIMIT $2`

async function ultimasOrdenes(args: ToolCallArgs, userId: string) {
  const limiteRaw = Number(pickArg(args, "limite", "limit") ?? 8)
  const limite = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 15) : 8
  const result = await pool.query<{
    id: string
    user_name: string | null
    status: string
    method: string | null
    months: number | null
    bonus_months: number | null
    amount: string | null
    currency: string | null
    error: string | null
    created_at: Date
    renewed_at: Date | null
  }>(ORDENES_SQL, [userId, limite])
  return {
    ok: true,
    ordenes: result.rows.map((row) => ({
      order_id: row.id,
      cliente: row.user_name,
      metodo: row.method,
      meses: row.months,
      meses_gratis: row.bonus_months ?? 0,
      monto: row.amount !== null ? Number(row.amount) : null,
      moneda: row.currency,
      estado: row.status,
      error: row.error,
      creada: row.created_at.toISOString(),
      renovada: row.renewed_at?.toISOString() ?? null,
    })),
  }
}

async function estadoOrden(args: ToolCallArgs, userId: string) {
  const orderId = pickArg(args, "order_id", "id")
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new AppError(422, "validation_error", "Falta el id de la orden.")
  }
  const user = await loadAuthUser(userId)
  if (!user) {
    throw new AppError(401, "unauthorized", "La cuenta ya no está disponible.")
  }
  const row = await getMpOrder(orderId.trim())
  // Solo el comprador (o un admin) ve la orden; a nadie más se le confirma
  // siquiera su existencia.
  if (!row || (row.buyer_user_id !== user.id && user.role !== "admin")) {
    throw new AppError(404, "not_found", "No encontré esa orden en tu cuenta.")
  }
  return {
    ok: true,
    order_id: row.id,
    cliente: row.user_name,
    metodo: row.method,
    meses: row.months,
    meses_gratis: row.bonus_months ?? 0,
    monto: row.amount,
    moneda: row.currency,
    estado: row.status,
    error: row.error,
    creada: row.created_at,
    renovada: row.renewed_at,
    vencimiento_verificado: row.renewal_verified_expires_at,
    proximo_reintento: row.renewal_next_retry_at,
  }
}

async function miPerfil(userId: string) {
  const user = await loadAuthUser(userId)
  if (!user) {
    throw new AppError(401, "unauthorized", "La cuenta ya no está disponible.")
  }
  const reseller = await getAccountDistribuidorName(user.id)
  const saldos = await getSaldosActual(user.id)
  return {
    ok: true,
    usuario: user.username,
    perfil: user.role === "admin" ? "administrador" : "distribuidor",
    reseller_flujotv: reseller,
    saldo_cupones: round2(saldos.cupones),
    saldo_tokens: round2(saldos.tokens),
  }
}

/* --------------------- Negocio: renovación con cupones -------------------- */

/**
 * Valida el objetivo de la renovación con el MISMO guard de alcance de las
 * rutas HTTP: sin distribuidor ligado no se compra y el distribuidor solo
 * compra para clientes de su reseller.
 */
async function assertRenewalTarget(
  user: AuthUser,
  userName: string
): Promise<void> {
  const scope = await resolveClientScope(user)
  if (scope.kind === "none") {
    throw new AppError(
      403,
      "forbidden",
      "Tu cuenta no tiene un distribuidor ligado: no puedes comprar renovaciones."
    )
  }
  if (scope.kind === "distributor") {
    const target = await getFlujoClient(userName, {
      timeoutMs: Math.min(FLUJO_PURCHASE_TIMEOUT_MS, TOOL_FLUJO_TIMEOUT_MS),
    })
    const allowed = target ? await isFlujoClientInScope(target, scope) : false
    if (!allowed) {
      throw new AppError(
        403,
        "forbidden",
        `El cliente '${userName}' no pertenece a tu distribuidor.`
      )
    }
  }
}

interface RenewalQuote {
  user: AuthUser
  userName: string
  months: number
  paquete: boolean
  bonusMonths: number
  totalMeses: number
  monto: number
  saldo: number
  suficiente: boolean
  canjeHabilitado: boolean
}

async function quoteRenewal(
  args: ToolCallArgs,
  userId: string
): Promise<RenewalQuote> {
  const user = await loadAuthUser(userId)
  if (!user) {
    throw new AppError(401, "unauthorized", "La cuenta ya no está disponible.")
  }
  const userNameRaw = pickArg(args, "user_name", "usuario", "username")
  const userName = typeof userNameRaw === "string" ? userNameRaw.trim() : ""
  if (userName.length === 0) {
    throw new AppError(
      422,
      "validation_error",
      "Falta el nombre de usuario de la licencia."
    )
  }
  const paquete = pickArg(args, "paquete") === true
  const months = Number(pickArg(args, "months", "meses"))
  if (paquete ? !isPaqueteMonths(months) : !isRenewalMonths(months)) {
    throw new AppError(
      422,
      "validation_error",
      paquete
        ? "Los meses del paquete deben ser 3, 6 o 12."
        : "Los meses deben ser 1, 3, 6 o 12."
    )
  }
  const price = licensePriceMxnOrNull()
  if (price === null) {
    throw new AppError(
      503,
      "not_configured",
      "El precio de la licencia no está configurado en el servidor."
    )
  }
  await assertRenewalTarget(user, userName)
  const saldos = await getSaldosActual(user.id)
  const bonusMonths = paquete ? paqueteBonusMonths(months as PaqueteMonths) : 0
  const monto = round2(price * months)
  return {
    user,
    userName,
    months,
    paquete,
    bonusMonths,
    totalMeses: months + bonusMonths,
    monto,
    saldo: round2(saldos.cupones),
    suficiente: saldos.cupones >= monto,
    canjeHabilitado: paquete || isCouponQaEnabled(),
  }
}

function quotePayload(quote: RenewalQuote) {
  return {
    ok: true,
    cliente: quote.userName,
    meses_pagados: quote.months,
    meses_gratis: quote.bonusMonths,
    meses_totales: quote.totalMeses,
    monto_mxn: quote.monto,
    saldo_cupones: quote.saldo,
    saldo_suficiente: quote.suficiente,
    canje_habilitado: quote.canjeHabilitado,
  }
}

async function cotizarRenovacion(args: ToolCallArgs, userId: string) {
  return quotePayload(await quoteRenewal(args, userId))
}

/*
 * request_id determinista por intención (comprador + cliente + plazo + hora
 * de Ciudad de México): un reintento dentro de la hora devuelve la orden
 * original en lugar de crear otra y volver a debitar (createCouponOrder es
 * idempotente por request_id). Una renovación deliberada más tarde abre
 * una intención nueva.
 */
function renewalRequestId(quote: RenewalQuote): string {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/[^0-9]/g, "")
    .slice(0, 10)
  const cliente = quote.userName.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `asistente-${quote.user.id.slice(0, 8)}-${cliente}-${quote.months}${quote.paquete ? "p" : ""}-${stamp}`
}

async function canjearRenovacion(args: ToolCallArgs, userId: string) {
  if (pickArg(args, "confirmar") !== true) {
    const quote = await quoteRenewal(args, userId)
    return {
      ok: false,
      error: {
        code: "confirmacion_requerida",
        message:
          "No se canjeó nada: cotiza con cotizar_renovacion, muéstrale el costo al usuario y solo canjea tras su confirmación explícita llamando de nuevo con confirmar=true.",
      },
      cotizacion: quotePayload(quote),
    }
  }

  const quote = await quoteRenewal(args, userId)
  const result = await createCouponOrder({
    userName: quote.userName,
    months: quote.months as RenewalMonths,
    buyerUserId: quote.user.id,
    code: quote.paquete ? PAQUETE_COUPON_CODE : "0000",
    requestId: renewalRequestId(quote),
    bonusMonths: quote.bonusMonths,
  })
  return {
    ok: true,
    order_id: result.orderId,
    estado: result.status,
    monto_mxn: result.amount,
    moneda: result.currency,
    meses_totales: quote.totalMeses,
    cliente: quote.userName,
    transaction_id: result.transactionId,
    repetida: result.replayed,
    nota:
      "La renovación se aplica en segundo plano y puede tardar unos minutos. Para saber si ya quedó, consulta estado_orden con order_id.",
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
      case "consultar_saldos":
        return JSON.stringify(await withTimeout(consultarSaldos(userId)))
      case "buscar_clientes":
        return JSON.stringify(await withTimeout(buscarClientes(args, userId)))
      case "proximos_vencimientos":
        return JSON.stringify(
          await withTimeout(proximosVencimientos(args, userId))
        )
      case "consultar_tickets":
        return JSON.stringify(await withTimeout(consultarTickets(args, userId)))
      case "consultar_paquetes":
        return JSON.stringify(await withTimeout(consultarPaquetes(userId)))
      case "ultimas_ordenes":
        return JSON.stringify(await withTimeout(ultimasOrdenes(args, userId)))
      case "estado_orden":
        return JSON.stringify(await withTimeout(estadoOrden(args, userId)))
      case "mi_perfil":
        return JSON.stringify(await withTimeout(miPerfil(userId)))
      case "cotizar_renovacion":
        return JSON.stringify(await withTimeout(cotizarRenovacion(args, userId)))
      case "canjear_renovacion":
        return JSON.stringify(await withTimeout(canjearRenovacion(args, userId)))
      default:
        return JSON.stringify({
          ok: false,
          error: `Herramienta desconocida: ${call.name}.`,
        })
    }
  } catch (error) {
    const message =
      error instanceof AppError ||
      error instanceof MercadoPagoError ||
      error instanceof FlujoApiError
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
