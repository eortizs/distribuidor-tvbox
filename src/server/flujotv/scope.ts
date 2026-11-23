import { isBranchRole } from "@/server/auth/types"
import type { FlujoClient } from "@/lib/flujotv"

import { getAccountDistribuidorName } from "@/server/auth/accounts"
import type { AuthUser } from "@/server/auth/types"
import { AppError } from "@/server/umejson/types"

import { getFlujoUserResellers } from "./service"

/**
 * Alcance de datos FlujoTV según el perfil del usuario autenticado:
 *
 * - `all`: sin restricción (perfil admin).
 * - `distributor`: solo los clientes asignados al reseller ligado a la
 *   cuenta (`dynamicProperties.distribuidorName` de su entidad Cuenta).
 * - `none`: perfil distribuidor sin reseller ligado; no ve ningún cliente.
 */
export type ClientScope =
  | { kind: "all" }
  | { kind: "distributor"; name: string }
  | { kind: "none" }

/**
 * Llaves probables del SUB-RESELLER en los datos crudos. Nunca `reseller`:
 * esa llave es la cuenta padre (p. ej. tvortiztv), constante en todas las
 * filas de `/get_clients`, y taparía al reseller real.
 */
const CLIENT_DISTRIBUTOR_KEYS = ["distributor", "distribuidor"]

function rawDistributorValue(raw: Record<string, unknown>): string {
  for (const key of CLIENT_DISTRIBUTOR_KEYS) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

/**
 * Resuelve el alcance del usuario: admin ve todo; el distribuidor queda
 * limitado al reseller ligado a su cuenta, y sin vínculo no ve nada (mostrar
 * el panel completo sería filtrar datos de otros distribuidores).
 */
export async function resolveClientScope(user: AuthUser): Promise<ClientScope> {
  if (!isBranchRole(user.role)) return { kind: "all" }
  const name = (await getAccountDistribuidorName(user.id))?.trim() ?? ""
  return name.length > 0 ? { kind: "distributor", name } : { kind: "none" }
}

/**
 * Distribuidor («socio») del cliente: llave cruda si viene, si no el mapa de
 * validez usuario→reseller (el mismo valor que muestra la tarjeta de
 * /clientes; compartido por la GUI y las herramientas del asistente).
 */
export function clientDistributor(
  client: FlujoClient,
  userResellers: Record<string, string>
): string {
  const fromRaw = rawDistributorValue(client.raw)
  if (fromRaw) return fromRaw.toLowerCase()
  return (
    userResellers[client.userName.trim().toLowerCase()]?.toLowerCase() ?? ""
  )
}

/**
 * Filtra el listado de clientes según el alcance. Con llave cruda de
 * distribuidor no hace ninguna lectura extra; si alguna fila la trae vacía,
 * resuelve la atribución con el mapa de `/users/validity` (una sola lectura,
 * tolerante a fallos: sin mapa solo cuentan las llaves crudas).
 */
export async function scopeFlujoClients<T extends FlujoClient>(
  clients: T[],
  scope: ClientScope
): Promise<T[]> {
  if (scope.kind === "all") return clients
  if (scope.kind === "none") return []
  const needle = scope.name.toLowerCase()
  const needsMap = clients.some((client) => rawDistributorValue(client.raw) === "")
  const userResellers = needsMap ? await getFlujoUserResellers() : {}
  return clients.filter(
    (client) => clientDistributor(client, userResellers) === needle
  )
}

/**
 * Veredicto de la guarda de alcance para un cliente concreto, en tres
 * estados:
 *
 * - `in`: en alcance (llave cruda o mapa de `/users/validity` lo atribuyen
 *   al distribuidor del scope).
 * - `out`: atribuido a OTRO distribuidor con certeza.
 * - `unknown`: la atribución NO llegó — fila ausente o sin llave de
 *   distribuidor en `/users/validity`, o lectura del mapa caída
 *   (`getFlujoUserResellers` degrada a `{}` sin avisar). El panel sirve
 *   `/users/validity` desde su caché y una instantánea puede venir sin la
 *   atribución de un cliente que SÍ pertenece al distribuidor (caso real
 *   16/nov: `/tv3fmendoza` por WhatsApp se rechazó con «no pertenece a tu
 *   distribuidor» dentro de una ventana así y minutos después el mapa ya
 *   traía `distributor: david`).
 *
 * La guarda de COMPRAS distingue `out` de `unknown` para no decir «no es
 * tuyo» cuando la verdad es «no lo sé ahora»: el rechazo definitivo cierra
 * la compra y el desconocido pide reintento (503 / mensaje transitorio).
 */
export type FlujoScopeVerdict = "in" | "out" | "unknown"

export async function flujoClientScopeVerdict(
  client: FlujoClient,
  scope: ClientScope
): Promise<FlujoScopeVerdict> {
  if (scope.kind === "all") return "in"
  if (scope.kind === "none") return "out"
  const needle = scope.name.toLowerCase()
  const fromRaw = rawDistributorValue(client.raw)
  if (fromRaw) return fromRaw.toLowerCase() === needle ? "in" : "out"
  const userResellers = await getFlujoUserResellers()
  const attributed =
    userResellers[client.userName.trim().toLowerCase()]?.trim().toLowerCase() ??
    ""
  if (!attributed) return "unknown"
  return attributed === needle ? "in" : "out"
}

/**
 * Guarda de compra FUENTE ÚNICA: resuelve el veredicto del cliente objetivo
 * y lanza los AppError canónicos de la política de compras — 503
 * `scope_unknown` TRANSITORIO cuando la atribución del panel no llegó
 * (reintento, nunca el definitivo «no es tuyo») y 403 `forbidden` para el
 * fuera-de-alcance certero. Las rutas HTTP convierten el AppError con su
 * catch existente (`errorResponse` / `flujoErrorResponse`) en la misma
 * respuesta que devolvían los bloques inline que reemplaza. Los flujos de
 * chat NO la usan: su rechazo va redactado como mensaje, no como error.
 */
export async function assertFlujoPurchaseScope(input: {
  userName: string
  target: FlujoClient | null
  scope: ClientScope
}): Promise<void> {
  const verdict = input.target
    ? await flujoClientScopeVerdict(input.target, input.scope)
    : "out"
  if (verdict === "unknown") {
    throw new AppError(
      503,
      "scope_unknown",
      `No pude confirmar que el cliente '${input.userName}' pertenezca a tu distribuidor: el panel de FlujoTV no reportó su atribución. Inténtalo de nuevo en unos minutos.`
    )
  }
  if (verdict === "out") {
    throw new AppError(
      403,
      "forbidden",
      `El cliente '${input.userName}' no pertenece a tu distribuidor.`
    )
  }
}

/**
 * Indica si un cliente concreto entra en el alcance (ruta de lectura
 * individual y superficies cuyo fallo seguro es OCULTAR: ver `unknown` de
 * {@link flujoClientScopeVerdict}). Con llave cruda resuelve en local; si
 * falta, consulta el mapa de `/users/validity`.
 */
export async function isFlujoClientInScope(
  client: FlujoClient,
  scope: ClientScope
): Promise<boolean> {
  return (await flujoClientScopeVerdict(client, scope)) === "in"
}

/** Resellers visibles: solo la fila del distribuidor ligado (o todas). */
export function scopeFlujoResellers<T extends { name: string }>(
  resellers: T[],
  scope: ClientScope
): T[] {
  if (scope.kind === "all") return resellers
  if (scope.kind === "none") return []
  const needle = scope.name.toLowerCase()
  return resellers.filter((row) => row.name.trim().toLowerCase() === needle)
}

/** Mapa usuario → reseller recortado al alcance (nada para `none`). */
export function scopeUserResellersMap(
  userResellers: Record<string, string>,
  scope: ClientScope
): Record<string, string> {
  if (scope.kind === "all") return userResellers
  if (scope.kind === "none") return {}
  const needle = scope.name.toLowerCase()
  return Object.fromEntries(
    Object.entries(userResellers).filter(
      ([, name]) => name.trim().toLowerCase() === needle
    )
  )
}

/**
 * Licencias visibles: igual criterio que los clientes, cruzando el usuario de
 * cada registro contra la llave cruda o el mapa de `/users/validity`.
 */
export async function scopeFlujoLicenses<
  T extends { userName: string | null; raw: Record<string, unknown> },
>(licenses: T[], scope: ClientScope): Promise<T[]> {
  if (scope.kind === "all") return licenses
  if (scope.kind === "none") return []
  const needle = scope.name.toLowerCase()
  const userResellers = await getFlujoUserResellers()
  return licenses.filter((record) => {
    if (!record.userName) return false
    const fromRaw = rawDistributorValue(record.raw)
    const distributor =
      fromRaw ||
      userResellers[record.userName.trim().toLowerCase()]?.toLowerCase() ||
      ""
    return distributor === needle
  })
}
