/*
 * Loading de la landing: NULO a propósito. El fallback del root
 * (src/app/loading.tsx) quedaba dentro del shell estático de /short como un
 * bloque «Cargando…» EN FLUJO antes del contenido: en conexiones móviles
 * lentas ocupaba espacio hasta la hidratación y desplazaba la página (CLS).
 * La landing es completamente estática — no necesita estado de carga.
 */
export default function Loading() {
  return null
}
