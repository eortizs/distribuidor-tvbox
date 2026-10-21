import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
