/**
 * Información pública de la app FlujoTV que muestra el módulo
 * «Actualización FlujoTV»: versión, código de downloader y enlaces de
 * descarga. El admin la edita desde la propia tarjeta y queda persistida
 * en la tabla `flujotv_app` (una sola fila); sin fila guardada se usan
 * estos valores por defecto.
 */

export interface FlujoAppInfo {
  version: string
  downloaderCode: string
  urlTv: string
  urlCelular: string
}

export const FLUJO_APP_DEFAULT: FlujoAppInfo = {
  version: "8.10.2",
  downloaderCode: "7459005",
  urlTv: "http://aftv.news/7459005",
  urlCelular: "http://aftv.news/1260616",
}

export type FlujoAppCampo = keyof FlujoAppInfo
