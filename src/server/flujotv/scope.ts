import type { FlujoClient } from "@/lib/flujotv"

import { getAccountDistribuidorName } from "@/server/auth/accounts"
import type { AuthUser } from "@/server/auth/types"

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
  if (user.role !== "distribuidor") return { kind: "all" }
  const name = (await getAccountDistribuidorName(user.id))?.trim() ?? ""
  return name.length > 0 ? { kind: "distributor", name } : { kind: "none" }
}

/** Distribuidor del cliente: llave cruda si viene, si no el mapa de validez. */
function clientDistributor(
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
 * Indica si un cliente concreto entra en el alcance (ruta de lectura
 * individual y guardia de renovaciones). Con llave cruda resuelve en local;
 * si falta, consulta el mapa de `/users/validity`.
 */
export async function isFlujoClientInScope(
  client: FlujoClient,
  scope: ClientScope
): Promise<boolean> {
  if (scope.kind === "all") return true
  if (scope.kind === "none") return false
  const needsMap = rawDistributorValue(client.raw) === ""
  const userResellers = needsMap ? await getFlujoUserResellers() : {}
  return clientDistributor(client, userResellers) === scope.name.toLowerCase()
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
