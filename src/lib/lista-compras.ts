/**
 * Dominio puro del módulo Lista de compras (`/modulos/lista-de-compras`).
 *
 * Lo consume el cliente (tipos, formato, agrupación), el servidor (validación
 * y aplicación de operaciones) y el test `scripts/test-lista-compras.mjs`.
 * No toca base de datos ni red: la interpretación con LLM vive en
 * `src/server/lista-compras/llm.ts` y la persistencia en el repositorio.
 *
 * La lista es un arreglo de productos con ID estable generado por el
 * servidor. Las mutaciones llegan como operaciones acotadas (agregar,
 * actualizar, eliminar, marcar, reemplazar, vaciar) que el LLM propone o el
 * cliente genera directo (casillas), y se aplican de forma determinista:
 * nada inventa cantidades ni fusiona variantes distintas.
 */

export const CATEGORIAS_COMPRA = [
  "Frutas y verduras",
  "Carnes y pescados",
  "Lácteos y huevos",
  "Panadería y tortillería",
  "Despensa",
  "Bebidas",
  "Congelados",
  "Limpieza",
  "Higiene y cuidado personal",
  "Mascotas",
  "Otros",
] as const

export type CategoriaCompra = (typeof CATEGORIAS_COMPRA)[number]

export const CATEGORIA_RESPALDO: CategoriaCompra = "Otros"

/** Unidades canónicas (singular); la pantalla las formatea. */
export const UNIDADES_COMPRA = [
  "g",
  "kg",
  "ml",
  "l",
  "pza",
  "paquete",
  "caja",
  "bolsa",
  "docena",
  "lata",
  "sobre",
  "botella",
] as const

export type UnidadCompra = (typeof UNIDADES_COMPRA)[number]

/** Plural de pantalla para cantidades mayores a uno. */
const PLURALES_UNIDAD: Record<UnidadCompra, string | null> = {
  g: null,
  kg: null,
  ml: null,
  l: null,
  pza: "pzas",
  paquete: "paquetes",
  caja: "cajas",
  bolsa: "bolsas",
  docena: "docenas",
  lata: "latas",
  sobre: "sobres",
  botella: "botellas",
}

export interface ItemLista {
  id: string
  nombre: string
  categoria: CategoriaCompra
  /** Cantidad explícita del usuario o estimada por pedido; null = sin cantidad. */
  cantidad: number | null
  unidad: UnidadCompra | null
  comprado: boolean
  /** true = la IA estimó cantidad o producto por pedido explícito del usuario. */
  estimado: boolean
}

export interface SnapshotLista {
  items: ItemLista[]
  revision: number
}

export interface ItemNuevo {
  nombre: string
  categoria?: CategoriaCompra
  cantidad?: number | null
  unidad?: UnidadCompra | null
  estimado?: boolean
}

export type Operacion =
  | {
      tipo: "agregar"
      nombre: string
      categoria?: CategoriaCompra
      cantidad?: number | null
      unidad?: UnidadCompra | null
      estimado?: boolean
      /** true = sumar a la cantidad existente (solo unidades compatibles). */
      suma?: boolean
    }
  | {
      tipo: "actualizar"
      id: string
      nombre?: string
      categoria?: CategoriaCompra
      cantidad?: number
      /** Default "establecer": fija la cantidad. "sumar" suma unidades iguales. */
      modoCantidad?: "establecer" | "sumar"
      unidad?: UnidadCompra | null
      estimado?: boolean
    }
  | { tipo: "eliminar"; id: string }
  | { tipo: "marcar"; id: string; comprado: boolean }
  | { tipo: "reemplazar"; items: ItemNuevo[] }
  | { tipo: "vaciar" }

export type ResultadoAplicacion =
  | { ok: true; items: ItemLista[] }
  | { ok: false; razon: string }

// Límites duros de dominio: el API rechaza antes de llegar a la base.
export const MAX_NOMBRE = 80
export const MAX_ITEMS = 200
export const MAX_OPS = 50
export const MAX_CANTIDAD = 9999
export const MAX_TEXTO_INTERPRETE = 4000

/** Texto comparable: sin acentos, minúsculas, sin signos ni espacios de más. */
export function claveProducto(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()"'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function esCategoria(value: string): value is CategoriaCompra {
  return (CATEGORIAS_COMPRA as readonly string[]).includes(value)
}

/** Categoría válida o respaldo: el LLM debe usar la lista cerrada. */
export function normalizarCategoria(value: unknown): CategoriaCompra {
  return typeof value === "string" && esCategoria(value)
    ? value
    : CATEGORIA_RESPALDO
}

function esUnidad(value: string): value is UnidadCompra {
  return (UNIDADES_COMPRA as readonly string[]).includes(value)
}

export function normalizarUnidad(value: unknown): UnidadCompra | null {
  if (typeof value !== "string") return null
  const clean = value.trim().toLowerCase()
  if (!clean) return null
  if (esUnidad(clean)) return clean
  // Alias comunes de dictado, con y sin acento.
  const alias: Record<string, UnidadCompra> = {
    gr: "g",
    grs: "g",
    gramos: "g",
    gramo: "g",
    kilo: "kg",
    kilos: "kg",
    kilogramos: "kg",
    litro: "l",
    litros: "l",
    mililitros: "ml",
    pieza: "pza",
    piezas: "pza",
    paquetes: "paquete",
    cajas: "caja",
    bolsas: "bolsa",
    docenas: "docena",
    latas: "lata",
    sobres: "sobre",
    botellas: "botella",
  }
  return alias[clean] ?? null
}

function normalizarCantidad(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const clean = Math.round(value * 100) / 100
  if (clean <= 0 || clean > MAX_CANTIDAD) return null
  return clean
}

/**
 * Mayúscula en la primera letra del nombre, solo cuando el nombre empieza
 * con letra: en «2 kg de pan» capitalizar la "k" de Kg se leería peor, así
 * que los nombres que no comienzan con letra quedan tal cual.
 */
export function capitalizarPrimeraLetra(nombre: string): string {
  if (!nombre || !/\p{L}/u.test(nombre[0] ?? "")) return nombre
  return `${nombre[0].toUpperCase()}${nombre.slice(1)}`
}

/** Valida un texto de producto y lo devuelve listo para guardar. */
export function normalizarNombre(
  value: unknown
): { ok: true; nombre: string } | { ok: false } {
  if (typeof value !== "string") return { ok: false }
  const nombre = capitalizarPrimeraLetra(value.replace(/\s+/g, " ").trim())
  if (!nombre || nombre.length > MAX_NOMBRE) return { ok: false }
  return { ok: true, nombre }
}

/**
 * Cantidad provista y válida, o null si no venía. Una cantidad que vino y no
 * es utilizable (0, negativa, excesiva, no numérica) hace inválida toda la
 * operación: silenciarla cambiaría el sentido del pedido.
 */
function cantidadObligatoria(
  value: unknown
): { presente: false } | { presente: true; ok: true; cantidad: number } | { presente: true; ok: false } {
  if (value === undefined || value === null) return { presente: false }
  const cantidad = normalizarCantidad(value)
  if (cantidad === null) return { presente: true, ok: false }
  return { presente: true, ok: true, cantidad }
}

/**
 * Valida y normaliza una operación de entrada (cliente o LLM). Acepta
 * formatos laxos y devuelve la operación estricta; devuelve null si la
 * operación no tiene sentido y debe descartarse con aviso al usuario.
 */
export function validarOperacion(input: unknown): Operacion | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const tipo = raw.tipo
  switch (tipo) {
    case "agregar": {
      const nombre = normalizarNombre(raw.nombre)
      if (!nombre.ok) return null
      const cantidadPedida = cantidadObligatoria(raw.cantidad)
      if (cantidadPedida.presente && !cantidadPedida.ok) return null
      const op: Extract<Operacion, { tipo: "agregar" }> = {
        tipo: "agregar",
        nombre: nombre.nombre,
        categoria: normalizarCategoria(raw.categoria),
      }
      if (cantidadPedida.presente && cantidadPedida.ok) {
        op.cantidad = cantidadPedida.cantidad
      }
      const unidad = normalizarUnidad(raw.unidad)
      if (unidad) op.unidad = unidad
      if (raw.estimado === true) op.estimado = true
      if (raw.suma === true) op.suma = true
      return op
    }
    case "actualizar": {
      if (typeof raw.id !== "string" || !raw.id) return null
      const op: Extract<Operacion, { tipo: "actualizar" }> = {
        tipo: "actualizar",
        id: raw.id,
      }
      if (raw.nombre !== undefined) {
        const nombre = normalizarNombre(raw.nombre)
        if (!nombre.ok) return null
        op.nombre = nombre.nombre
      }
      if (raw.categoria !== undefined) {
        op.categoria = normalizarCategoria(raw.categoria)
      }
      const cantidadPedida = cantidadObligatoria(raw.cantidad)
      if (cantidadPedida.presente && !cantidadPedida.ok) return null
      if (cantidadPedida.presente && cantidadPedida.ok) {
        op.cantidad = cantidadPedida.cantidad
        op.modoCantidad = raw.modoCantidad === "sumar" ? "sumar" : "establecer"
      }
      if (raw.unidad !== undefined) {
        op.unidad = normalizarUnidad(raw.unidad)
      }
      if (raw.estimado === true) op.estimado = true
      return op
    }
    case "eliminar": {
      if (typeof raw.id !== "string" || !raw.id) return null
      return { tipo: "eliminar", id: raw.id }
    }
    case "marcar": {
      if (typeof raw.id !== "string" || !raw.id) return null
      if (typeof raw.comprado !== "boolean") return null
      return { tipo: "marcar", id: raw.id, comprado: raw.comprado }
    }
    case "reemplazar": {
      if (!Array.isArray(raw.items)) return null
      if (raw.items.length > MAX_ITEMS) return null
      const items: ItemNuevo[] = []
      for (const item of raw.items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null
        }
        const itemRaw = item as Record<string, unknown>
        const nombre = normalizarNombre(itemRaw.nombre)
        if (!nombre.ok) return null
        const cantidadPedida = cantidadObligatoria(itemRaw.cantidad)
        if (cantidadPedida.presente && !cantidadPedida.ok) return null
        const nuevo: ItemNuevo = { nombre: nombre.nombre }
        nuevo.categoria = normalizarCategoria(itemRaw.categoria)
        if (cantidadPedida.presente && cantidadPedida.ok) {
          nuevo.cantidad = cantidadPedida.cantidad
        }
        const unidad = normalizarUnidad(itemRaw.unidad)
        if (unidad) nuevo.unidad = unidad
        if (itemRaw.estimado === true) nuevo.estimado = true
        items.push(nuevo)
      }
      return { tipo: "reemplazar", items }
    }
    case "vaciar":
      return { tipo: "vaciar" }
    default:
      return null
  }
}

export function validarOperaciones(input: unknown): Operacion[] {
  if (!Array.isArray(input)) return []
  return input
    .slice(0, MAX_OPS)
    .map(validarOperacion)
    .filter((op): op is Operacion => op !== null)
}

function clonar(items: ItemLista[]): ItemLista[] {
  return items.map((item) => ({ ...item }))
}

/**
 * Aplica operaciones de forma determinista sobre la lista. Toda la tanda se
 * valida contra el mismo snapshot: si una operación referencía un producto
 * que no existe, la tanda completa se rechaza (razón clara, lista intacta),
 * porque casi siempre significa que la lista cambió en otro lado.
 */
export function aplicarOperaciones(
  items: ItemLista[],
  ops: Operacion[]
): ResultadoAplicacion {
  const porId = new Map(items.map((item) => [item.id, item]))

  for (const op of ops) {
    if (
      (op.tipo === "actualizar" ||
        op.tipo === "eliminar" ||
        op.tipo === "marcar") &&
      !porId.has(op.id)
    ) {
      return {
        ok: false,
        razon:
          "Un producto mencionado ya no está en la lista. Revisa el estado actual y vuelve a intentarlo.",
      }
    }
  }

  const resultado = clonar(items)

  for (const op of ops) {
    switch (op.tipo) {
      case "agregar": {
        const clave = claveProducto(op.nombre)
        const existente = resultado.find(
          (item) => claveProducto(item.nombre) === clave
        )
        if (existente) {
          // Ya está: no se duplica ni se toca su cantidad sin instrucción
          // explícita. Volver a pedirlo lo regresa a pendiente.
          existente.comprado = false
          if (op.estimado) existente.estimado = true
          const sumaPedida = op.cantidad
          if (sumaPedida !== undefined && sumaPedida !== null && op.suma) {
            // "agrega otros 2": solo unidades compatibles. Un producto sin
            // cantidad adopta la nueva porque no hay nada que confluya.
            if (
              existente.cantidad === null ||
              existente.unidad === (op.unidad ?? null)
            ) {
              const base = existente.cantidad ?? 0
              const suma = Math.round((base + sumaPedida) * 100) / 100
              if (suma > 0 && suma <= MAX_CANTIDAD) {
                existente.cantidad = suma
                if (op.unidad) existente.unidad = op.unidad
              }
            }
          }
          continue
        }
        if (resultado.length >= MAX_ITEMS) continue
        resultado.push({
          id: "",
          nombre: op.nombre,
          categoria: normalizarCategoria(op.categoria),
          cantidad: op.cantidad ?? null,
          unidad: op.unidad ?? null,
          comprado: false,
          estimado: op.estimado === true,
        })
        continue
      }
      case "actualizar": {
        const item = resultado.find((buscado) => buscado.id === op.id)
        if (!item) continue
        if (op.nombre !== undefined) item.nombre = op.nombre
        if (op.categoria !== undefined) item.categoria = op.categoria
        if (op.cantidad !== undefined) {
          if (op.modoCantidad === "sumar") {
            // Sumar solo si las unidades coinciden (ambas null cuenta como
            // iguales). Incompatibles: la cantidad queda como está.
            if (item.unidad === (op.unidad ?? item.unidad)) {
              const suma =
                Math.round(((item.cantidad ?? 0) + op.cantidad) * 100) / 100
              if (suma > 0 && suma <= MAX_CANTIDAD) item.cantidad = suma
            }
          } else {
            item.cantidad = op.cantidad
            if (op.unidad !== undefined) item.unidad = op.unidad
          }
        } else if (op.unidad !== undefined) {
          item.unidad = op.unidad
        }
        if (op.estimado) item.estimado = true
        continue
      }
      case "eliminar": {
        const index = resultado.findIndex((item) => item.id === op.id)
        if (index >= 0) resultado.splice(index, 1)
        continue
      }
      case "marcar": {
        const item = resultado.find((buscado) => buscado.id === op.id)
        if (item) item.comprado = op.comprado
        continue
      }
      case "reemplazar": {
        resultado.length = 0
        for (const nuevo of op.items) {
          resultado.push({
            id: "",
            nombre: nuevo.nombre,
            categoria: normalizarCategoria(nuevo.categoria),
            cantidad: nuevo.cantidad ?? null,
            unidad: nuevo.unidad ?? null,
            comprado: false,
            estimado: nuevo.estimado === true,
          })
        }
        continue
      }
      case "vaciar": {
        resultado.length = 0
        continue
      }
    }
  }

  return { ok: true, items: resultado }
}

/**
 * Confirmación obligatoria, derivada en servidor de las operaciones contra
 * la lista real: reemplazar (aun con lista vacía resultante, que equivale a
 * vaciar) o vaciar una lista con productos, o eliminar productos. Nunca se
 * confía en un indicador del LLM.
 */
export function requiereConfirmacion(
  items: ItemLista[],
  ops: Operacion[]
): boolean {
  if (items.length === 0) return false
  return ops.some(
    (op) => op.tipo === "vaciar" || op.tipo === "eliminar" || op.tipo === "reemplazar"
  )
}

/** "2 kg", "1.5 l", "12 pzas" o "" si no hay cantidad. */
export function formatCantidad(item: Pick<ItemLista, "cantidad" | "unidad">) {
  if (item.cantidad === null) return ""
  if (item.unidad === null) return String(item.cantidad)
  const unidad =
    item.cantidad !== 1 ? (PLURALES_UNIDAD[item.unidad] ?? item.unidad) : item.unidad
  return `${item.cantidad} ${unidad}`
}

/** Grupos en el orden canónico de categorías; categorías vacías se omiten. */
export function agruparPorCategoria(
  items: ItemLista[]
): { categoria: CategoriaCompra; items: ItemLista[] }[] {
  const grupos = new Map<CategoriaCompra, ItemLista[]>()
  for (const item of items) {
    const grupo = grupos.get(item.categoria)
    if (grupo) grupo.push(item)
    else grupos.set(item.categoria, [item])
  }
  return [...grupos.entries()]
    .sort(
      (a, b) =>
        CATEGORIAS_COMPRA.indexOf(a[0]) - CATEGORIAS_COMPRA.indexOf(b[0])
    )
    .map(([categoria, itemsDeCategoria]) => ({ categoria, items: itemsDeCategoria }))
}

export function contarPendientes(items: ItemLista[]): {
  pendientes: number
  total: number
} {
  return {
    pendientes: items.filter((item) => !item.comprado).length,
    total: items.length,
  }
}
