import type { TenantModule } from "@/lib/tenant-modules"
import { tenantAllows } from "@/lib/tenant-modules"
import {
  BellRingIcon,
  CalculatorIcon,
  ClapperboardIcon,
  ImageIcon,
  LandmarkIcon,
  MessageCircleIcon,
  MonitorDownIcon,
  PackageIcon,
  PiggyBankIcon,
  PlugZapIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  ShoppingBasketIcon,
  StickyNoteIcon,
  TimerIcon,
  UserCogIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * Catálogo del hub de módulos (`/modulos`), compartido por el cliente
 * (listado) y el servidor (validación de preferencias): una sola fuente
 * para los hrefs válidos.
 */

export interface ModuloFiltro {
  id: string
  name: string
}

/** Módulo (href) → ids de filtros a los que pertenece. */
export type Asignaciones = Record<string, string[]>

export interface ModulePrefs {
  favorites: string[]
  categories: ModuloFiltro[]
  assignments: Asignaciones
}

export interface Modulo {
  title: string
  description: string
  href: string
  /** Módulo de tenant al que pertenece (§4.5): filtra el catálogo por tenant. */
  modulo: TenantModule
  icon: LucideIcon
  /**
   * Solo visible para cuentas admin: el hub oculta la tarjeta y la ruta
   * queda servida detrás de `requireRole("propietario")`.
   */
  adminOnly?: boolean
  /**
   * El botón «Configurar» del hub abre la herramienta en modo configuración
   * (`href` + `?editar=1`). Sin esta marca, «Configurar» sigue siendo
   * maqueta sin funcionalidad.
   */
  configurable?: boolean
}

/**
 * Versión serializable de `Modulo` para cruzar la frontera RSC → Client
 * Component: sin el `icon`, que es una función y las funciones NO viajan
 * del servidor al cliente (React 441 «Functions cannot be passed directly
 * to Client Components»). El cliente re-atacha el icono desde el catálogo
 * estático por `href`.
 */
export type ModuloSerial = Omit<Modulo, "icon">

export const MODULOS: Modulo[] = [
  {
    title: "Alertas",
    description:
      "Describe en lenguaje natural qué vigilar y la IA busca en internet para avisarte; también crea recordatorios.",
    href: "/modulos/alertas",
    modulo: "general",
    icon: BellRingIcon,
  },
  {
    title: "Imágenes",
    description:
      "Genera y edita imágenes con IA desde texto, referencias o bocetos a mano.",
    href: "/modulos/imagenes",
    modulo: "general",
    icon: ImageIcon,
  },
  {
    title: "Animación",
    description:
      "Del idea al render con el agente EVE: guiones, storyboards y entregables con costo y tiempo.",
    href: "/modulos/animacion",
    modulo: "general",
    icon: ClapperboardIcon,
  },
  {
    title: "Conectores",
    description:
      "Conecta tus cuentas de Google Calendar y otros servicios para usarlos desde el panel.",
    href: "/modulos/conectores",
    modulo: "general",
    icon: PlugZapIcon,
  },
  {
    title: "Calculadora",
    description:
      "Cálculos rápidos con porcentaje, cinta de historial y cobro con link de pago.",
    href: "/modulos/calculadora",
    modulo: "core",
    icon: CalculatorIcon,
  },
  {
    title: "Cronómetro",
    description:
      "Mide el tiempo con cronómetro de vueltas o cuenta regresiva con aviso sonoro.",
    href: "/modulos/cronometro",
    modulo: "general",
    icon: TimerIcon,
  },
  {
    title: "Lista de compras",
    description:
      "Dicta o escribe tu lista con IA: productos por categoría, cantidades y casillas de comprado.",
    href: "/modulos/lista-de-compras",
    modulo: "general",
    icon: ShoppingBasketIcon,
  },
  {
    title: "Notas",
    description:
      "Notas rápidas con título, dictado por voz, búsqueda y notas fijadas, guardadas en tu cuenta.",
    href: "/modulos/notas",
    modulo: "general",
    icon: StickyNoteIcon,
  },
  {
    title: "Paquetes FlujoTV",
    description:
      "Renueva licencias en paquetes de 3, 6 y 12 meses con meses de regalo y los mismos métodos de pago.",
    href: "/modulos/paquetes-flujotv",
    modulo: "flujo",
    icon: PackageIcon,
  },
  {
    title: "Actualización FlujoTV",
    description:
      "Versión de la app, código de downloader y enlaces de descarga para TV, tablet, PC y celular, listos para copiar.",
    href: "/modulos/actualizacion-flujotv",
    modulo: "flujo",
    icon: MonitorDownIcon,
    configurable: true,
  },
  {
    title: "Alta de tickets",
    description:
      "Toma una foto del ticket o elige un archivo y la IA extrae sus datos para revisarlos y confirmarlos.",
    href: "/modulos/alta-de-tickets",
    modulo: "general",
    icon: ReceiptTextIcon,
  },
  {
    title: "Abonar saldo",
    description:
      "Elige tokens (herramientas con APIs) o cupones (licencias FlujoTV), define el monto y paga con Mercado Pago, transferencia o cupón.",
    href: "/modulos/abonar-saldo",
    modulo: "flujo",
    icon: PiggyBankIcon,
  },
  {
    title: "SPEILink",
    description:
      "Emite un cobro de monto libre con concepto de pago: link corto spei.link con QR; el pagador solicita el pago por WhatsApp, recibe su concepto y paga por SPEI.",
    href: "/modulos/links-de-pago",
    modulo: "core",
    icon: QrCodeIcon,
  },
  {
    title: "Reporte SPEILink",
    description:
      "Depósitos por transferencia SPEI acreditados en Mercado Pago, del día actual o de un día específico: el admin consulta la cuenta del servidor y cada distribuidor la suya con su token del Perfil.",
    href: "/modulos/reporte-spei",
    modulo: "core",
    icon: LandmarkIcon,
  },
  {
    title: "Distribuidores",
    description:
      "Gestiona las cuentas de distribuidores: saldo, permisos, edición y baja, con el mismo menú de Usuarios.",
    href: "/modulos/distribuidores",
    modulo: "flujo",
    icon: UserCogIcon,
    adminOnly: true,
  },
  {
    title: "WhatsApp",
    description:
      "Vincula el número del agente IA, espeja las notificaciones del panel y atiende consultas de las cuentas registradas.",
    href: "/modulos/whatsapp",
    modulo: "core",
    icon: MessageCircleIcon,
    adminOnly: true,
  },
]

const MODULO_HREFS = new Set(MODULOS.map((modulo) => modulo.href))

/**
 * Hrefs de los módulos cuya visibilidad se puede ajustar por usuario (todo el
 * catálogo menos los `adminOnly`, que las cuentas no-admin nunca ven): claves
 * válidas de `user_module_permissions`.
 */
export const MODULE_PERMISSION_KEYS: string[] = MODULOS.filter(
  (modulo) => !modulo.adminOnly
).map((modulo) => modulo.href)

/**
 * Hrefs que nacen VISIBLES por defecto para las cuentas no-admin: el catálogo
 * ajustable completo existente cuando el default pasó a «oculto» (16/nov
 * 2026). Congelado a propósito — NO se deriva de `MODULOS`. Al crear un
 * módulo nuevo: se agrega a `MODULOS` (el sheet «Módulos» de
 * `/modulos/distribuidores` lo lista solo) y NO va aquí, así nace OCULTO
 * para todas las cuentas no-admin hasta que el admin lo haga visible.
 */
export const MODULES_DEFAULT_VISIBLE_HREFS: ReadonlySet<string> = new Set([
  "/modulos/alertas",
  "/modulos/imagenes",
  "/modulos/animacion",
  "/modulos/conectores",
  "/modulos/calculadora",
  "/modulos/cronometro",
  "/modulos/lista-de-compras",
  "/modulos/paquetes-flujotv",
  "/modulos/actualizacion-flujotv",
  "/modulos/alta-de-tickets",
  "/modulos/abonar-saldo",
])

const MODULE_PERMISSION_KEYS_SET = new Set(MODULE_PERMISSION_KEYS)

/** True si el href pertenece al catálogo ajustable por usuario. */
export function isModulePermissionKey(value: string): boolean {
  return MODULE_PERMISSION_KEYS_SET.has(value)
}

export const MODULO_PREFS_EMPTY: ModulePrefs = {
  favorites: [],
  categories: [],
  assignments: {},
}

/**
 * Valida la forma de unas preferencias y suelta lo desconocido: favoritos de
 * módulos inexistentes, filtros sin nombre y asignaciones a filtros que ya
 * no existen. Compartida por cliente (migración desde localStorage) y
 * servidor (guardado), así que ambos aceptan exactamente lo mismo.
 */
export function normalizeModulePrefs(input: unknown): ModulePrefs {
  if (!input || typeof input !== "object") return { ...MODULO_PREFS_EMPTY }
  const raw = input as {
    favorites?: unknown
    categories?: unknown
    assignments?: unknown
  }
  const favorites = Array.isArray(raw.favorites)
    ? [
        ...new Set(
          raw.favorites.filter(
            (value): value is string =>
              typeof value === "string" && MODULO_HREFS.has(value)
          )
        ),
      ]
    : []
  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .map((item) => {
          if (!item || typeof item !== "object") return null
          const { id, name } = item as { id?: unknown; name?: unknown }
          if (typeof id !== "string" || id === "") return null
          if (typeof name !== "string" || name.trim() === "") return null
          return { id, name: name.trim().slice(0, 40) }
        })
        .filter((item): item is ModuloFiltro => item !== null)
    : []
  const ids = new Set(categories.map((category) => category.id))
  const assignments: Asignaciones = {}
  if (raw.assignments && typeof raw.assignments === "object") {
    for (const [href, list] of Object.entries(
      raw.assignments as Record<string, unknown>
    )) {
      if (!MODULO_HREFS.has(href) || !Array.isArray(list)) continue
      const clean = [
        ...new Set(
          list.filter(
            (value): value is string => typeof value === "string" && ids.has(value)
          )
        ),
      ]
      if (clean.length > 0) assignments[href] = clean
    }
  }
  return { favorites, categories, assignments }
}

/** Igualdad estructural canónica para comparar snapshots de preferencias. */
export function modulePrefsEqual(
  a: ModulePrefs | null,
  b: ModulePrefs | null
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}


/** Proyección serializable de un módulo (sin el icono, que no viaja). */
const toSerial = (modulo: Modulo): ModuloSerial => ({
  title: modulo.title,
  description: modulo.description,
  href: modulo.href,
  modulo: modulo.modulo,
  adminOnly: modulo.adminOnly,
  configurable: modulo.configurable,
})

/**
 * Catálogo filtrado por los módulos habilitados del tenant (§4.5): el hub
 * de Módulos y las APIs de visibilidad sirven SOLO los módulos del tenant
 * (legado = los tres; negocio = núcleo). `allowed` null = sin restricción
 * (plataforma/legado sin contexto). Devuelve la forma serializable: la
 * página RSC se la pasa al hub cliente y los iconos no pueden viajar.
 */
export function modulosForTenantModules(
  allowed: string[] | null | undefined
): ModuloSerial[] {
  if (allowed === null || allowed === undefined) return MODULOS.map(toSerial)
  return MODULOS.filter((modulo) => tenantAllows(allowed, modulo.modulo)).map(
    toSerial
  )
}
