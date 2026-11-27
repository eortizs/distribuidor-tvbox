import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  /*
   * Baileys (gateway WhatsApp) es un paquete de Node con requires dinámicos
   * (pino, protobufjs): fuera del bundle del servidor para que se cargue
   * desde node_modules tal cual.
   */
  serverExternalPackages: ["@whiskeysockets/baileys", "pino"],
  /*
   * Soporte dejó de ser un menú y ahora es una página con pestañas bajo
   * /soporte: las rutas antiguas redirigen para no romper accesos guardados.
   */
  async redirects() {
    return [
      {
        source: "/asistente",
        destination: "/soporte/asistente",
        permanent: false,
      },
      {
        source: "/configuracion",
        destination: "/soporte/configuracion",
        permanent: false,
      },
      {
        source: "/configuracion/:path*",
        destination: "/soporte/configuracion/:path*",
        permanent: false,
      },
      {
        source: "/lab",
        destination: "/soporte/lab",
        permanent: false,
      },
      {
        source: "/lab/:path*",
        destination: "/soporte/lab/:path*",
        permanent: false,
      },
      {
        // El módulo pasó de «Orden de pago» a «Links de pago»; los enlaces
        // guardados y los revalidatePath viejos siguen.
        source: "/modulos/orden-de-pago",
        destination: "/modulos/links-de-pago",
        permanent: false,
      },
      {
        // Rebautizo «Ligas de pago» → «Links de pago» (2026-11-20): la URL
        // anterior sigue viva para los enlaces guardados.
        source: "/modulos/ligas-de-pago",
        destination: "/modulos/links-de-pago",
        permanent: false,
      },
      {
        // Rebautizo «Nota Digital» → «Pedidos» (2026-11-27): la URL
        // anterior sigue viva para los enlaces guardados.
        source: "/modulos/nota-digital",
        destination: "/modulos/pedidos",
        permanent: false,
      },
    ];
  },
  experimental: {
    /*
     * El chat de animación manda los adjuntos dentro del JSON del turno
     * (data URL en base64, ~1.37×) y eve vive en un destino externo: Next
     * proxya ese body con `proxyClientMaxBodySize`, que por defecto es 10 MB
     * y trunca la petición (el turno falla con un 500 opaco). El tope de la
     * UI (15 MB de adjuntos ≈ 21 MB de body) queda holgadamente por debajo.
     */
    proxyClientMaxBodySize: "64mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withEve(nextConfig);
