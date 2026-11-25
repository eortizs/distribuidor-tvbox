import type { MetadataRoute } from "next"

import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"

/**
 * Manifiesto PWA por HOST (reestructura de bloques 2026-11-24): el host de
 * plataforma se llama SPEILink (el dueño lo pidió — la pestaña/PWA no debe
 * leer TVBOX allí); el legado y los negocios conservan la marca TVBOX.
 * Dinámico a propósito (lee `headers()` vía requestHost): el layout raíz
 * sigue ESTÁTICO para que la landing prerenderizada no se toque.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const platform = resolveTenantHost(await requestHost()).kind === "platform"
  return {
    name: platform ? "SPEILink" : "Distribuidor TVBox",
    short_name: platform ? "SPEILink" : "TVBOX",
    description: platform
      ? "Panel de administración de SPEILink"
      : "Panel de administración del distribuidor TVBox",
    start_url: "/",
    display: "standalone",
    background_color: "#fcfcfb",
    theme_color: "#fcfcfb",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
