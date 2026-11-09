/*
 * Verificación determinística de un comprobante de transferencia contra los
 * datos reales de la orden. Dominio puro (sin IO ni LLM): el modelo
 * RECEIPT_SCAN_MODEL extrae los datos impresos y AQUÍ se decide si el pago
 * cumple las cuatro condiciones de autorización:
 *
 *   1. Fecha dentro del mes actual (la hora es informativa).
 *   2. Concepto con el usuario de FlujoTV que se renueva (p. ej.
 *      «usuario flujotv: tv3abcd»; mayúsculas, acentos, espacios y signos
 *      no importan; otro usuario no pasa).
 *   3. Importe ≥ al importe congelado de la orden (pago exacto o a favor;
 *      un faltante no autoriza).
 *
 * Estrictos SOLO en fecha, concepto e importe. El beneficiario es
 * TOLERANTE: los comprobantes traen nombres ambiguos, así que basta con
 * que cada palabra del titular configurado aparezca completa («ENRIQUE
 * ORTIZ», «Enrique Ortiz Santos», «ORTIZ, ENRIQUE») o como inicial suelta
 * («E. Ortiz», «Enrique O»); si el comprobante no arroja beneficiario
 * legible tampoco bloquea (el origen/destino implícito ya lo resolvió el
 * modelo al extraer). Un nombre ajeno completo sí rechaza: otra persona,
 * otra cuenta.
 */

export interface DatosComprobante {
  fecha: string | null
  hora: string | null
  concepto: string | null
  importe: string | null
  moneda: string | null
  beneficiario: string | null
  emisor: string | null
}

export interface CondicionEvaluada {
  /** Clave estable: fecha | concepto | importe | beneficiario. */
  key: "fecha" | "concepto" | "importe" | "beneficiario"
  label: string
  passed: boolean
  /** Detalle legible de lo que se esperaba y lo que se leyó. */
  detail: string
}

/** Tolerancia para importes con redondeo del banco (p. ej. 99.99 vs 100). */
const AMOUNT_TOLERANCE_MXN = 0.01

/** Normaliza texto para comparaciones: minúsculas, sin acentos ni signos. */
function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

/** Tokens normalizados (palabras e iniciales) de un nombre impreso. */
function tokensDeNombre(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/** "2026-11-08" → { year, month } | null (formato estricto). */
function parseFechaIso(
  value: string | null
): { year: number; month: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

function parseImporte(value: string | null): number | null {
  if (!value) return null
  const normalized = value.replace(/[,\s$]/g, "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Evalúa las cuatro condiciones contra los datos de la orden. `now` se
 * inyecta para poder probar; en producción es el momento del escaneo.
 */
export function evaluarCondiciones(input: {
  datos: DatosComprobante
  userName: string
  amountMxn: number
  holderName: string
  now?: Date
}): CondicionEvaluada[] {
  const now = input.now ?? new Date()
  const expected = {
    fecha: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    concepto: input.userName,
    importe: input.amountMxn.toFixed(2),
    beneficiario: input.holderName,
  }

  // 1. Fecha dentro del mes actual (año y mes iguales; el día puede ser
  //    cualquiera del mes vigente, incluso hoy).
  const fecha = parseFechaIso(input.datos.fecha)
  const fechaOk =
    fecha !== null &&
    fecha.year === now.getFullYear() &&
    fecha.month === now.getMonth() + 1

  // 2. El concepto menciona el usuario de FlujoTV renovado, ignorando
  //    mayúsculas, acentos, espacios y signos («usuario flujotv: tv3abcd»,
  //    «TV3ABCD», «tv3 abcd»… todo pasa; otro usuario no).
  const conceptoOk =
    input.datos.concepto !== null &&
    normalizarTexto(input.datos.concepto).includes(
      normalizarTexto(input.userName)
    )

  // 3. Importe leído ≥ importe de la orden (pago exacto o a favor; un
  //    faltante no autoriza). Sin importe legible, falla.
  const importe = parseImporte(input.datos.importe)
  const importeOk = importe !== null && importe >= input.amountMxn - AMOUNT_TOLERANCE_MXN

  // 4. Beneficiario TOLERANTE (no estricto): cada palabra del titular debe
  //    aparecer completa en el nombre impreso O como inicial suelta
  //    («E. Ortiz» cubre a Enrique; «Enrique O» cubre a Ortiz); sin
  //    beneficiario legible no bloquea. Un nombre ajeno completo sin ninguna
  //    coincidencia sí rechaza (otra persona, otra cuenta).
  const holderWords = input.holderName
    .split(/\s+/)
    .map((word) => normalizarTexto(word))
    .filter((word) => word.length > 0)
  const beneficiarioTokens =
    input.datos.beneficiario !== null
      ? tokensDeNombre(input.datos.beneficiario)
      : []
  const beneficiarioNorm = beneficiarioTokens.join("")
  const beneficiarioOk =
    holderWords.length === 0 ||
    beneficiarioNorm.length === 0 ||
    holderWords.every((word) =>
      beneficiarioNorm.includes(word) ||
      beneficiarioTokens.some(
        (token) => token.length === 1 && token[0] === word[0]
      )
    )

  return [
    {
      key: "fecha",
      label: "Fecha del comprobante (mes actual)",
      passed: fechaOk,
      detail: `esperado ${expected.fecha}; leído ${input.datos.fecha ?? "ilegible"}`,
    },
    {
      key: "concepto",
      label: `Concepto con el usuario de FlujoTV '${input.userName}'`,
      passed: conceptoOk,
      detail: `leído ${input.datos.concepto ? `«${input.datos.concepto}»` : "ilegible"}`,
    },
    {
      key: "importe",
      label: `Importe de ${expected.importe} MXN`,
      passed: importeOk,
      detail: `esperado ≥ ${expected.importe}; leído ${input.datos.importe ?? "ilegible"}`,
    },
    {
      key: "beneficiario",
      label: `Beneficiario ${expected.beneficiario} (tolerante)`,
      passed: beneficiarioOk,
      detail: `leído ${
        input.datos.beneficiario
          ? `«${input.datos.beneficiario}»`
          : "ilegible (no bloquea)"
      }`,
    },
  ]
}
