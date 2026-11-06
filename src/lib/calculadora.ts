/**
 * Lógica pura de la Calculadora: una máquina de estados pequeña compartida
 * por los botones y el teclado. Sin `eval`, `Function` ni parser de
 * expresiones: las operaciones se encadenan en orden de pulsación
 * (`2 + 3 × 4 = 20`), según lo acordado.
 */

export type CalculatorOperator = "+" | "-" | "*" | "/"

export interface CalculatorState {
  /** Texto mostrado en la pantalla: entrada activa, resultado o `0`. */
  display: string
  /** Acumulador de la operación pendiente, si la hay. */
  accumulator: number | null
  /** Operador pendiente de un segundo operando. */
  operator: CalculatorOperator | null
  /** La siguiente cifra inicia una entrada nueva (tras operador o resultado). */
  awaitingOperand: boolean
  /** `%` ya transformó esta entrada y no hubo escritura nueva. */
  percentApplied: boolean
  /** Última operación completa, para repetir `=`. */
  lastOperator: CalculatorOperator | null
  lastOperand: number | null
  /** Mensaje de error legible; no nulo bloquea operadores y `%`. */
  error: string | null
  /** Texto para la región viva: solo resultados y errores, nunca cada dígito. */
  announce: string | null
}

export type CalculatorAction =
  | { type: "digit"; digit: string | number }
  | { type: "decimal" }
  | { type: "sign" }
  | { type: "backspace" }
  | { type: "operator"; operator: CalculatorOperator }
  | { type: "percent" }
  | { type: "equals" }
  | { type: "clear" }

/** Máximo de caracteres de cifra en una entrada (decimales incluidos). */
export const MAX_INPUT_DIGITS = 15

const OPERATOR_SYMBOLS: Record<CalculatorOperator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
}

export function operatorSymbol(operator: CalculatorOperator): string {
  return OPERATOR_SYMBOLS[operator]
}

export function createInitialCalculatorState(): CalculatorState {
  return {
    display: "0",
    accumulator: null,
    operator: null,
    awaitingOperand: false,
    percentApplied: false,
    lastOperator: null,
    lastOperand: null,
    error: null,
    announce: null,
  }
}

/** Agrupa la parte entera de un texto numérico plano con comas de millar. */
function groupThousands(text: string): string {
  const [intPart, ...rest] = text.split(".")
  const sign = intPart.startsWith("-") ? "-" : ""
  const digits = sign ? intPart.slice(1) : intPart
  const frac = rest.length > 0 ? `.${rest.join(".")}` : ""
  return `${sign}${(digits || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac}`
}

/**
 * Agrupa una entrada o resultado textual para la pantalla (`2500` →
 * `2,500`), preservando el punto decimal pendiente y sin tocar la
 * notación científica. Solo para renderizar: el estado guarda el texto
 * sin comas para que `Number()` siga parseándolo.
 */
export function formatCalculatorEntryText(text: string): string {
  if (text.includes("e")) return text
  return groupThousands(text)
}

/** Igual que `formatCalculatorNumber`, con millares agrupados. */
function formatGroupedNumber(value: number): string {
  const text = formatCalculatorNumber(value)
  return text.includes("e") ? text : groupThousands(text)
}

/**
 * Operación en construcción para la línea grande, p. ej. `25+2,500`.
 * `null` cuando no hay operación pendiente (tras `=` la pantalla solo
 * muestra el resultado).
 */
export function calculatorExpression(state: CalculatorState): string | null {
  if (state.accumulator === null || state.operator === null) return null
  const entry = state.awaitingOperand
    ? ""
    : formatCalculatorEntryText(state.display)
  return `${formatGroupedNumber(state.accumulator)}${operatorSymbol(state.operator)}${entry}`
}

/**
 * Resultado previo mientras se construye la operación (iOS): `25+2,500`
 * muestra `2,525` antes de pulsar `=`. Si el paso intermedio no es finito
 * (p. ej. `5÷0` sin cerrar), muestra la entrada tal cual.
 */
export function calculatorPreview(state: CalculatorState): string | null {
  if (state.accumulator === null || state.operator === null || state.error) {
    return null
  }
  // Sin operando escrito el previo es el propio acumulador (`8×` → 8).
  if (state.awaitingOperand) return formatGroupedNumber(state.accumulator)
  const value = compute(state.accumulator, state.operator, Number(state.display))
  if (!Number.isFinite(value)) return formatCalculatorEntryText(state.display)
  return formatGroupedNumber(value)
}

function compute(a: number, operator: CalculatorOperator, b: number): number {
  switch (operator) {
    case "+":
      return a + b
    case "-":
      return a - b
    case "*":
      return a * b
    case "/":
      return b === 0 ? NaN : a / b
  }
}

function divideByZero(operator: CalculatorOperator): boolean {
  return operator === "/"
}

/**
 * Normaliza un resultado a 15 cifras significativas (sin residuos como
 * `0.30000000000000004`), con notación científica cuando el número no cabe
 * en la pantalla y `-0` normalizado a `0`.
 */
export function formatCalculatorNumber(value: number): string {
  if (!Number.isFinite(value)) return "0"
  if (value === 0) return "0"
  const magnitude = Math.abs(value)
  const normalized = Number(value.toPrecision(MAX_INPUT_DIGITS))
  if (normalized === 0) return "0"
  if (magnitude >= 1e15 || magnitude < 1e-6) {
    const [mantissa, exponent] = normalized.toExponential(MAX_INPUT_DIGITS - 1).split("e")
    const trimmed = mantissa.replace(/0+$/, "").replace(/\.$/, "")
    return `${trimmed}e${exponent}`
  }
  return String(normalized)
}

/** Cifras de la entrada sin signo ni punto decimal. */
function inputDigitCount(display: string): number {
  return display.replace(/[^0-9]/g, "").length
}

function withEntry(state: CalculatorState, display: string): CalculatorState {
  return { ...state, display, awaitingOperand: false, percentApplied: false }
}

export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction
): CalculatorState {
  switch (action.type) {
    case "digit":
      return reduceDigit(state, action.digit)
    case "decimal":
      return reduceDecimal(state)
    case "sign":
      return reduceSign(state)
    case "backspace":
      return reduceBackspace(state)
    case "operator":
      return reduceOperator(state, action.operator)
    case "percent":
      return reducePercent(state)
    case "equals":
      return reduceEquals(state)
    case "clear":
      return createInitialCalculatorState()
  }
}

function clearError(state: CalculatorState): CalculatorState {
  return { ...state, error: null, announce: null }
}

function reduceDigit(state: CalculatorState, digit: string | number): CalculatorState {
  const value = String(digit)
  if (!/^[0-9]$/.test(value)) return state
  // Tras un error, un dígito permite empezar otra operación.
  if (state.error) {
    return { ...createInitialCalculatorState(), display: value }
  }
  if (state.awaitingOperand) {
    return clearError({ ...state, display: value, awaitingOperand: false, percentApplied: false })
  }
  const active = state.display
  if (active === "0") return clearError(withEntry(state, value))
  if (inputDigitCount(active) >= MAX_INPUT_DIGITS) return clearError(state)
  return clearError(withEntry(state, `${active}${value}`))
}

function reduceDecimal(state: CalculatorState): CalculatorState {
  if (state.error) {
    return { ...createInitialCalculatorState(), display: "0." }
  }
  if (state.awaitingOperand) {
    return clearError({ ...state, display: "0.", awaitingOperand: false, percentApplied: false })
  }
  if (state.display.includes(".")) return clearError(state)
  return clearError(withEntry(state, `${state.display}.`))
}

function reduceSign(state: CalculatorState): CalculatorState {
  if (state.error) return state
  // Con un operando sin escribir (solo operador pendiente) no hay nada que
  // invertir; con un resultado sí se invierte el valor calculado.
  if (state.awaitingOperand && state.operator !== null) return state
  if (state.awaitingOperand && state.accumulator !== null) {
    const value = Number(state.display)
    if (value === 0) return state
    // El resultado invertido se vuelve el acumulador para que el operador
    // siguiente continúe desde el valor mostrado.
    return clearError({
      ...state,
      display: formatCalculatorNumber(-value),
      accumulator: -value,
    })
  }
  const active = state.display
  if (Number(active) === 0) return state
  const flipped = active.startsWith("-") ? active.slice(1) : `-${active}`
  return clearError({ ...state, display: flipped, percentApplied: false })
}

function reduceBackspace(state: CalculatorState): CalculatorState {
  // El retroceso edita solo la entrada activa: tras un resultado o un
  // operador no modifica silenciosamente el valor mostrado.
  if (state.error || state.awaitingOperand) return state
  const trimmed = state.display.slice(0, -1)
  const next = trimmed === "" || trimmed === "-" ? "0" : trimmed
  return { ...state, display: next, percentApplied: false }
}

function arithmeticError(operator: CalculatorOperator): string | null {
  return divideByZero(operator) ? "No se puede dividir entre cero" : null
}

function failState(state: CalculatorState, message: string): CalculatorState {
  return {
    ...createInitialCalculatorState(),
    error: message,
    announce: message,
  }
}

function reduceOperator(state: CalculatorState, operator: CalculatorOperator): CalculatorState {
  if (state.error) return state
  // Sin un nuevo operando, el operador reemplaza al anterior (`8 + × 2 = 16`)
  // o continúa desde un resultado.
  if (state.awaitingOperand) {
    return clearError({ ...state, operator })
  }
  const operand = Number(state.display)
  if (state.accumulator !== null && state.operator !== null) {
    const value = compute(state.accumulator, state.operator, operand)
    if (!Number.isFinite(value)) {
      return failState(state, arithmeticError(state.operator) ?? "Resultado fuera de rango")
    }
    return clearError({
      ...state,
      display: formatCalculatorNumber(value),
      accumulator: value,
      operator,
      awaitingOperand: true,
      percentApplied: false,
    })
  }
  // Sin operación pendiente, la entrada actual se vuelve el acumulador.
  return clearError({
    ...state,
    display: formatCalculatorNumber(operand),
    accumulator: operand,
    operator,
    awaitingOperand: true,
    percentApplied: false,
  })
}

function reducePercent(state: CalculatorState): CalculatorState {
  if (state.error || state.percentApplied) return state
  // Con un operando sin escribir no hay entrada que transformar.
  if (state.awaitingOperand && state.operator !== null) return state
  const value = Number(state.display)
  const transformed =
    (state.operator === "+" || state.operator === "-") && state.accumulator !== null
      ? (state.accumulator * value) / 100
      : value / 100
  if (!Number.isFinite(transformed)) {
    return failState(state, "Resultado fuera de rango")
  }
  const display = formatCalculatorNumber(transformed)
  return clearError({
    ...state,
    display,
    // El texto exponencial no es editable: la siguiente cifra inicia una
    // entrada nueva en vez de alterar mantisa o exponente.
    awaitingOperand: display.includes("e"),
    percentApplied: true,
  })
}

function reduceEquals(state: CalculatorState): CalculatorState {
  if (state.error) return state
  // `=` sin segundo operando no inventa uno y deja el valor actual.
  if (state.operator !== null && state.accumulator !== null) {
    if (state.awaitingOperand) {
      return clearError({
        ...state,
        // El valor mostrado queda como acumulador para que el operador
        // siguiente continúe desde él.
        accumulator: Number(state.display),
        operator: null,
        awaitingOperand: true,
        percentApplied: false,
      })
    }
    const operand = Number(state.display)
    const value = compute(state.accumulator, state.operator, operand)
    if (!Number.isFinite(value)) {
      return failState(state, arithmeticError(state.operator) ?? "Resultado fuera de rango")
    }
    const display = formatCalculatorNumber(value)
    return {
      ...state,
      display,
      accumulator: value,
      operator: null,
      awaitingOperand: true,
      percentApplied: false,
      lastOperator: state.operator,
      lastOperand: operand,
      error: null,
      announce: display,
    }
  }
  // Tras un cálculo completo, `=` repetido repite la última operación.
  if (state.lastOperator !== null && state.lastOperand !== null) {
    const operand = Number(state.display)
    const value = compute(operand, state.lastOperator, state.lastOperand)
    if (!Number.isFinite(value)) {
      return failState(state, arithmeticError(state.lastOperator) ?? "Resultado fuera de rango")
    }
    const display = formatCalculatorNumber(value)
    return {
      ...state,
      display,
      accumulator: value,
      awaitingOperand: true,
      percentApplied: false,
      error: null,
      announce: display,
    }
  }
  return clearError(state)
}
