import { CalendarCheckIcon, HardDriveIcon, MailIcon, type LucideIcon } from "lucide-react"

/**
 * Catálogo de conectores del módulo Conectores (`/modulos/conectores`),
 * compartido por el cliente (listado) y el servidor (validación del id en
 * las rutas OAuth): una sola fuente para los ids válidos y sus scopes.
 *
 * Un conector nuevo se agrega con una entrada aquí; el flujo OAuth vive
 * por proveedor (`providerId`), así que otro proveedor solo necesita su
 * módulo de tokens en `src/server/conectores/` y su ruta de callback.
 */

export type ConectorEstado = "disponible" | "proximamente"

export interface Conector {
  /** Id estable del conector: viaja en rutas y en la base de datos. */
  id: string
  /** Proveedor del conector, en minúsculas y sin espacios. */
  providerId: string
  /** Rótulo del proveedor para agrupar el catálogo en la pantalla. */
  proveedor: string
  title: string
  description: string
  icon: LucideIcon
  estado: ConectorEstado
  /**
   * Scopes OAuth sensibles que pide el conector al proveedor (solo
   * disponibles). Los scopes de identidad (openid, email) los añade el
   * flujo por su cuenta para saber qué cuenta quedó conectada.
   */
  scopes?: string[]
}

export const CONECTORES: Conector[] = [
  {
    id: "google-calendar",
    providerId: "google",
    proveedor: "Google",
    title: "Google Calendar",
    description:
      "Crea y consulta eventos del calendario de tu cuenta de Google desde el panel.",
    icon: CalendarCheckIcon,
    estado: "disponible",
    // Alcance mínimo de eventos: crear, leer y editar eventos, sin tocar
    // la configuración de los calendarios. Cambiarlo aquí es la única
    // pieza a tocar si el consent screen aprobó otro scope.
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  },
  {
    id: "google-drive",
    providerId: "google",
    proveedor: "Google",
    title: "Google Drive",
    description:
      "Guarda y comparte archivos del panel en el Drive de tu cuenta de Google.",
    icon: HardDriveIcon,
    estado: "proximamente",
  },
  {
    id: "outlook-calendar",
    providerId: "microsoft",
    proveedor: "Microsoft",
    title: "Outlook Calendar",
    description:
      "Sincroniza eventos con el calendario de Outlook de tu cuenta de Microsoft.",
    icon: MailIcon,
    estado: "proximamente",
  },
]

/** Proveedores con flujo OAuth implementado en el servidor. */
export const PROVEEDORES_OAUTH = new Set(["google"])

export function findConector(id: string): Conector | null {
  return CONECTORES.find((conector) => conector.id === id) ?? null
}

/** El conector existe, está disponible y su proveedor tiene flujo OAuth. */
export function isConectorConectable(id: string): boolean {
  const conector = findConector(id)
  return Boolean(
    conector &&
      conector.estado === "disponible" &&
      PROVEEDORES_OAUTH.has(conector.providerId)
  )
}

export interface ConexionPublica {
  connectorId: string
  providerId: string
  /** connected | error */
  status: "connected" | "error"
  /** Cuenta del proveedor conectada; null si el proveedor no la reportó. */
  accountEmail: string | null
  connectedAt: string
}
