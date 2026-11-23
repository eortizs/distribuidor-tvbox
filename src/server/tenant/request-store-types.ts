/**
 * Forma mínima del store de headers de Next (next/headers) para tipar el
 * acceso de tenancy sin importar `next/headers` estáticamente (eve evalúa
 * los módulos authored fuera del runtime de Next).
 */
export interface ReadableHeaders {
  get(name: string): string | null
}
