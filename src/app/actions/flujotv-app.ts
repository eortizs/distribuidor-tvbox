"use server"

import { type FlujoAppCampo, type FlujoAppInfo } from "@/lib/flujotv-app"
import { requireUser } from "@/server/auth/guards"
import { saveFlujoAppCampo } from "@/server/flujotv/app"

const CAMPOS: FlujoAppCampo[] = [
  "version",
  "downloaderCode",
  "urlTv",
  "urlCelular",
]

/**
 * Guarda un campo de la tarjeta «Actualización FlujoTV» (versión, código
 * de downloader o enlaces de descarga). Solo un admin: esta información se
 * comparte con todos los distribuidores del panel. Devuelve el estado
 * completo resultante para repintar la tarjeta.
 */
export async function guardarFlujoAppCampoAction(
  campo: string,
  valor: string
): Promise<FlujoAppInfo> {
  const user = await requireUser()
  if (user.role !== "admin") {
    throw new Error("Solo un administrador puede editar esta información.")
  }
  const campoValido = CAMPOS.find((item) => item === campo)
  if (!campoValido) {
    throw new Error("Campo desconocido.")
  }
  return saveFlujoAppCampo(campoValido, valor, user.id)
}
