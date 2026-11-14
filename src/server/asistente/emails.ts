/*
 * Aliasing reversible de correos para los agentes de chat (Asistente del
 * panel y WhatsApp). El gateway del proveedor del modelo redacta cualquier
 * texto con forma de correo EN AMBAS DIRECCIONES: el modelo nunca recibe el
 * correo real y no puede emitirlo (lo sustituye por "[EMAIL]" o, peor,
 * inventa uno plausible — observado en producción con varios modelos).
 *
 * La solución es del lado de la app: los resultados de las herramientas se
 * envían al modelo con los correos sustituidos por tokens opacos
 * (`[CORREO-1]`, …) que el gateway no redacta; el valor real solo existe
 * en el servidor y se restaura en la salida hacia el usuario. De paso,
 * el modelo deja de poder inventar direcciones: si cita el token, el
 * usuario ve el dato correcto; si inventa otra cosa, no hay colisión.
 *
 * El mapa vive POR TURNO (una instancia por solicitud): el mismo correo
 * siempre produce el mismo token dentro del turno y el mapa muere con él.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const TOKEN_RE = /\[CORREO-\d+\]/g

/** Longitud del token más largo posible: presupuesto de retención del stream. */
export const MAX_TOKEN_LENGTH = "[CORREO-999999]".length

export class EmailAliases {
  private readonly tokenByEmail = new Map<string, string>()
  private readonly emailByToken = new Map<string, string>()

  /** Sustituye cada correo del texto por su token estable del turno. */
  alias(text: string): string {
    return text.replace(EMAIL_RE, (email) => {
      let token = this.tokenByEmail.get(email)
      if (!token) {
        token = `[CORREO-${this.tokenByEmail.size + 1}]`
        this.tokenByEmail.set(email, token)
        this.emailByToken.set(token, email)
      }
      return token
    })
  }

  /** Restituye los tokens por el correo real. Lo desconocido queda igual. */
  restore(text: string): string {
    return text.replace(TOKEN_RE, (token) => this.emailByToken.get(token) ?? token)
  }
}
