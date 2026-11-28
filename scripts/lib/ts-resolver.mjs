/**
 * Resolver de módulos para las pruebas Node-directo (patrón del repo:
 * `node scripts/test-*.mjs` con Node 24 eliminando tipos al importar .ts).
 * Node resuelve el import raíz con extensión `.ts`, pero NO los imports
 * INTERNOS sin extensión de los propios módulos TS (`./chrome-print`).
 * Este hook reintenta el specifier con `.ts` solo cuando el módulo relativo
 * no existe tal cual; todo lo demás pasa intacto por el resolver normal.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const relativo =
      specifier.startsWith("./") || specifier.startsWith("../")
    if (error?.code === "ERR_MODULE_NOT_FOUND" && relativo && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
