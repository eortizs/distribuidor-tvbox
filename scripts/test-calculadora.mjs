/**
 * Pruebas de la lógica pura de la Calculadora (src/lib/calculadora.ts):
 * operaciones, encadenamiento en orden de pulsación, porcentaje comercial,
 * reemplazo de operador, igual repetido, decimales, signo, retroceso,
 * límites de entrada, reinicio y errores. Corre con Node directo (Node 24
 * elimina tipos al importar .ts):
 *
 *   node scripts/test-calculadora.mjs
 */
import assert from "node:assert/strict"

import {
  MAX_INPUT_DIGITS,
  calculatorExpression,
  calculatorPreview,
  calculatorReducer,
  createInitialCalculatorState,
  formatCalculatorEntryText,
  formatCalculatorNumber,
  operatorSymbol,
} from "../src/lib/calculadora.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/** Reduce una secuencia de acciones desde el estado inicial. */
function run(...actions) {
  return actions.reduce(calculatorReducer, createInitialCalculatorState())
}

const d = (digit) => ({ type: "digit", digit })
const op = (operator) => ({ type: "operator", operator })
const DECIMAL = { type: "decimal" }
const SIGN = { type: "sign" }
const BACKSPACE = { type: "backspace" }
const PERCENT = { type: "percent" }
const EQUALS = { type: "equals" }
const CLEAR = { type: "clear" }
const PLUS = op("+")
const MINUS = op("-")
const TIMES = op("*")
const DIVIDE = op("/")

/** Escribe un número como dígitos (punto decimal incluido). */
function typeNumber(text) {
  return [...text].map((ch) => (ch === "." ? DECIMAL : d(ch)))
}

/* ---------------------------- estado inicial ----------------------------- */

check("el estado inicial muestra 0 y no tiene operación pendiente", () => {
  const state = createInitialCalculatorState()
  assert.equal(state.display, "0")
  assert.equal(state.error, null)
  assert.equal(calculatorExpression(state), null)
  assert.equal(calculatorPreview(state), null)
})

check("los símbolos de operador son legibles en español", () => {
  assert.equal(operatorSymbol("+"), "+")
  assert.equal(operatorSymbol("-"), "−")
  assert.equal(operatorSymbol("*"), "×")
  assert.equal(operatorSymbol("/"), "÷")
})

/* ---------------------------- operaciones -------------------------------- */

check("escribe dígitos respetando el cero inicial", () => {
  assert.equal(run(d(0), d(0), d(5)).display, "5")
  assert.equal(run(d(1), d(2), d(3)).display, "123")
})

check("suma, resta, multiplica y divide", () => {
  assert.equal(run(...typeNumber("12"), PLUS, ...typeNumber("7"), EQUALS).display, "19")
  assert.equal(run(...typeNumber("12"), MINUS, ...typeNumber("7"), EQUALS).display, "5")
  assert.equal(run(...typeNumber("12"), TIMES, ...typeNumber("7"), EQUALS).display, "84")
  assert.equal(run(...typeNumber("12"), DIVIDE, ...typeNumber("4"), EQUALS).display, "3")
})

check("encadena en orden de pulsación: 2 + 3 × 4 = 20", () => {
  assert.equal(run(d(2), PLUS, d(3), TIMES, d(4), EQUALS).display, "20")
})

check("muestra la operación en grande y el resultado previo debajo", () => {
  const operating = run(...typeNumber("25"), PLUS, ...typeNumber("2500"))
  assert.equal(calculatorExpression(operating), "25+2,500")
  assert.equal(calculatorPreview(operating), "2,525")
  // Solo operador: sin operando escrito el previo es el acumulador.
  assert.equal(calculatorExpression(run(d(8), TIMES)), "8×")
  assert.equal(calculatorPreview(run(d(8), TIMES)), "8")
  // Tras = la operación se borra y el resultado queda solo, en grande.
  const done = run(d(2), PLUS, d(3), EQUALS)
  assert.equal(calculatorExpression(done), null)
  assert.equal(calculatorPreview(done), null)
})

check("el resultado previo sigue al porcentaje y al paso no finito", () => {
  const percent = run(...typeNumber("200"), PLUS, ...typeNumber("10"), PERCENT)
  assert.equal(calculatorExpression(percent), "200+20")
  assert.equal(calculatorPreview(percent), "220")
  // 5÷0 sin cerrar: el previo muestra la entrada tal cual, sin error.
  const open = run(d(5), DIVIDE, d(0))
  assert.equal(calculatorExpression(open), "5÷0")
  assert.equal(calculatorPreview(open), "0")
})

check("un operador tras un resultado continúa desde ese resultado", () => {
  const state = run(d(2), PLUS, d(3), EQUALS, TIMES, d(2), EQUALS)
  assert.equal(state.display, "10")
})

/* ---------------------------- porcentajes -------------------------------- */

check("porcentaje aislado: 10 % = 0.1", () => {
  assert.equal(run(...typeNumber("10"), PERCENT).display, "0.1")
  assert.equal(run(...typeNumber("10"), PERCENT, EQUALS).display, "0.1")
})

check("porcentaje con suma o resta es relativo al acumulador", () => {
  assert.equal(run(...typeNumber("200"), PLUS, ...typeNumber("10"), PERCENT).display, "20")
  assert.equal(run(...typeNumber("200"), PLUS, ...typeNumber("10"), PERCENT, EQUALS).display, "220")
  assert.equal(run(...typeNumber("200"), MINUS, ...typeNumber("10"), PERCENT, EQUALS).display, "180")
})

check("porcentaje con multiplicación o división usa la fracción", () => {
  assert.equal(run(...typeNumber("200"), TIMES, ...typeNumber("10"), PERCENT, EQUALS).display, "20")
  assert.equal(run(...typeNumber("200"), DIVIDE, ...typeNumber("10"), PERCENT, EQUALS).display, "2000")
})

check("pulsaciones consecutivas de % no transforman dos veces", () => {
  assert.equal(run(...typeNumber("10"), PERCENT, PERCENT).display, "0.1")
  assert.equal(run(...typeNumber("50"), PERCENT, PERCENT, EQUALS).display, "0.5")
  // Editar la entrada permite aplicar % de nuevo.
  assert.equal(run(...typeNumber("10"), PERCENT, d(5), PERCENT).display, "0.0015")
})

check("% sin operando escrito no hace nada y % tras resultado divide entre 100", () => {
  assert.equal(run(...typeNumber("200"), PLUS, PERCENT).display, "200")
  assert.equal(run(d(5), PLUS, d(3), EQUALS, PERCENT).display, "0.08")
})

check("% en notación científica no es editable dígito a dígito", () => {
  const state = run(...typeNumber("0.0000001"), PERCENT)
  assert.equal(state.display, "1e-9")
  // Una cifra nueva inicia la entrada; no altera el exponente.
  assert.equal(calculatorReducer(state, d(5)).display, "5")
  // Punto y retroceso tampoco corrompen el valor mostrado.
  assert.equal(calculatorReducer(state, DECIMAL).display, "0.")
  assert.equal(calculatorReducer(state, BACKSPACE).display, "1e-9")
})

/* ---------------------------- operador e igual --------------------------- */

check("un segundo operador sin operando reemplaza al anterior", () => {
  assert.equal(run(d(8), PLUS, TIMES, d(2), EQUALS).display, "16")
  assert.equal(run(d(8), PLUS, MINUS, d(2), EQUALS).display, "6")
})

check("= sin segundo operando deja el valor actual", () => {
  const state = run(d(5), PLUS, EQUALS)
  assert.equal(state.display, "5")
  assert.equal(run(d(5), PLUS, EQUALS, EQUALS).display, "5")
  // El operador siguiente continúa desde el valor mostrado.
  assert.equal(run(d(5), PLUS, EQUALS, PLUS, d(3), EQUALS).display, "8")
})

check("= repetido repite la última operación: 2 + 3 = = muestra 8", () => {
  assert.equal(run(d(2), PLUS, d(3), EQUALS, EQUALS).display, "8")
  assert.equal(run(d(2), PLUS, d(3), EQUALS, EQUALS, EQUALS).display, "11")
  // También repite sobre una entrada nueva.
  assert.equal(run(d(2), PLUS, d(3), EQUALS, d(4), EQUALS).display, "7")
})

check("un dígito tras el resultado inicia una entrada nueva", () => {
  const state = run(d(2), PLUS, d(3), EQUALS, d(7))
  assert.equal(state.display, "7")
  assert.equal(calculatorExpression(state), null)
})

check("agrupa los miles con comas al renderizar, sin tocar el estado", () => {
  assert.equal(formatCalculatorEntryText("2525"), "2,525")
  assert.equal(formatCalculatorEntryText("1234.5"), "1,234.5")
  assert.equal(formatCalculatorEntryText("0.5"), "0.5")
  assert.equal(formatCalculatorEntryText("0."), "0.")
  assert.equal(formatCalculatorEntryText("-1234"), "-1,234")
  assert.equal(formatCalculatorEntryText("0"), "0")
  assert.equal(formatCalculatorEntryText("1.5e+18"), "1.5e+18")
  // El estado interno sigue sin comas para que Number() lo parsee.
  assert.equal(run(...typeNumber("25"), PLUS, ...typeNumber("2500"), EQUALS).display, "2525")
})

/* ---------------------------- decimales y signo --------------------------- */

check("acepta un único separador decimal", () => {
  assert.equal(run(DECIMAL, d(5)).display, "0.5")
  assert.equal(run(d(1), DECIMAL, d(5)).display, "1.5")
  assert.equal(run(d(1), DECIMAL, DECIMAL, d(5)).display, "1.5")
  assert.equal(run(d(1), DECIMAL).display, "1.")
})

check("el cambio de signo invierte la entrada y el resultado", () => {
  assert.equal(run(d(5), SIGN).display, "-5")
  assert.equal(run(d(5), SIGN, SIGN).display, "5")
  assert.equal(run(d(5), SIGN, PLUS, d(3), EQUALS).display, "-2")
  assert.equal(run(d(2), PLUS, d(3), EQUALS, SIGN).display, "-5")
  // El resultado invertido es el acumulador: el operador continúa desde él.
  assert.equal(run(d(2), PLUS, d(3), EQUALS, SIGN, PLUS, d(4), EQUALS).display, "-1")
  // Sobre 0 no genera «-0».
  assert.equal(run(SIGN).display, "0")
  assert.equal(run(d(0), SIGN).display, "0")
})

check("no hay «-0» en los resultados ni en el formato", () => {
  assert.equal(run(d(1), SIGN, TIMES, d(0), EQUALS).display, "0")
  assert.equal(formatCalculatorNumber(-0), "0")
})

/* ---------------------------- retroceso y límites ------------------------ */

check("el retroceso edita solo la entrada activa", () => {
  assert.equal(run(d(1), d(2), d(3), BACKSPACE).display, "12")
  assert.equal(run(d(1), DECIMAL, d(5), BACKSPACE).display, "1.")
  assert.equal(run(d(5), BACKSPACE).display, "0")
  assert.equal(run(d(1), SIGN, BACKSPACE).display, "0")
  assert.equal(run(BACKSPACE).display, "0")
})

check("el retroceso no modifica un resultado ni un valor pendiente", () => {
  assert.equal(run(d(2), PLUS, d(3), EQUALS, BACKSPACE).display, "5")
  assert.equal(run(d(2), PLUS, BACKSPACE).display, "2")
})

check("limita la entrada a 15 caracteres de cifra", () => {
  const sixteen = Array.from({ length: MAX_INPUT_DIGITS + 1 }, (_, i) => d(i % 10))
  const state = run(...sixteen)
  assert.equal(state.display.replace(/[^0-9]/g, "").length, MAX_INPUT_DIGITS)
  // El punto no cuenta como cifra: cabe sobre una entrada llena sin punto.
  const full = run(...Array.from({ length: MAX_INPUT_DIGITS }, (_, i) => d((i % 9) + 1)))
  assert.equal(full.display.replace(/[^0-9]/g, "").length, MAX_INPUT_DIGITS)
  assert.equal(calculatorReducer(full, DECIMAL).display.length, MAX_INPUT_DIGITS + 1)
})

check("normaliza resultados a 15 cifras significativas", () => {
  assert.equal(run(...typeNumber("0.1"), PLUS, ...typeNumber("0.2"), EQUALS).display, "0.3")
  assert.equal(run(...typeNumber("10"), DIVIDE, d(3), EQUALS).display, "3.33333333333333")
  assert.equal(formatCalculatorNumber(0.30000000000000004), "0.3")
  assert.equal(formatCalculatorNumber(200 * 0.1), "20")
})

check("usa notación científica cuando el número no cabe", () => {
  assert.equal(formatCalculatorNumber(1e15), "1e+15")
  assert.equal(formatCalculatorNumber(999999999999999), "999999999999999")
  assert.equal(formatCalculatorNumber(1.5e18), "1.5e+18")
  assert.equal(formatCalculatorNumber(1e-7), "1e-7")
  assert.equal(formatCalculatorNumber(0.0000005), "5e-7")
  assert.equal(formatCalculatorNumber(0.000001), "0.000001")
  assert.equal(run(...typeNumber("1000000"), TIMES, ...typeNumber("1000000000"), EQUALS).display, "1e+15")
})

/* ---------------------------- reinicio y errores ------------------------- */

check("limpiar reinicia todo, incluida la memoria del igual repetido", () => {
  const state = run(d(2), PLUS, d(3), EQUALS, EQUALS, CLEAR)
  assert.deepEqual(state, createInitialCalculatorState())
  // Sin memoria tras limpiar, = no repite nada.
  assert.equal(run(d(2), PLUS, d(3), EQUALS, EQUALS, CLEAR, d(7), EQUALS).display, "7")
})

check("la división entre cero muestra un error legible", () => {
  const state = run(d(5), DIVIDE, d(0), EQUALS)
  assert.equal(state.error, "No se puede dividir entre cero")
  assert.equal(state.announce, state.error)
  assert.ok(!/Infinity|NaN/.test(state.display), state.display)
})

check("los operadores y % en error no propagan valores inválidos", () => {
  const error = run(d(5), DIVIDE, d(0), EQUALS)
  assert.equal(calculatorReducer(error, PLUS).error, "No se puede dividir entre cero")
  assert.equal(calculatorReducer(error, TIMES).display, "0")
  assert.equal(calculatorReducer(error, PERCENT).display, "0")
  assert.equal(calculatorReducer(error, SIGN).display, "0")
  assert.equal(calculatorReducer(error, BACKSPACE).display, "0")
  assert.equal(calculatorReducer(error, EQUALS).display, "0")
})

check("un dígito, el punto o limpiar permiten empezar otra operación", () => {
  const error = run(d(5), DIVIDE, d(0), EQUALS)
  const freshDigit = calculatorReducer(error, d(7))
  assert.equal(freshDigit.error, null)
  assert.equal(freshDigit.display, "7")
  const freshDecimal = calculatorReducer(error, DECIMAL)
  assert.equal(freshDecimal.error, null)
  assert.equal(freshDecimal.display, "0.")
  const cleared = calculatorReducer(error, CLEAR)
  assert.deepEqual(cleared, createInitialCalculatorState())
  assert.equal(run(d(5), DIVIDE, d(0), EQUALS, d(8), PLUS, d(2), EQUALS).display, "10")
})

check("un resultado fuera de rango muestra error", () => {
  let state = run(...typeNumber("999999999999999"), TIMES, ...typeNumber("999999999999999"), EQUALS)
  assert.equal(state.display, "9.99999999999998e+29")
  // Repetir = multiplica por 999999999999999 hasta desbordar.
  for (let i = 0; i < 20; i += 1) state = calculatorReducer(state, EQUALS)
  assert.equal(state.error, "Resultado fuera de rango")
  assert.ok(!/Infinity|NaN/.test(state.display), state.display)
})

check("la región viva anuncia resultados y errores, no cada dígito", () => {
  const evaluated = run(d(2), PLUS, d(3), EQUALS)
  assert.equal(evaluated.announce, "5")
  assert.equal(calculatorReducer(evaluated, d(7)).announce, null)
  assert.equal(run(d(5), DIVIDE, d(0), EQUALS).announce, "No se puede dividir entre cero")
  assert.equal(createInitialCalculatorState().announce, null)
})

check("el formato de números es estable para valores cotidianos", () => {
  assert.equal(formatCalculatorNumber(0), "0")
  assert.equal(formatCalculatorNumber(19), "19")
  assert.equal(formatCalculatorNumber(-19), "-19")
  assert.equal(formatCalculatorNumber(0.5), "0.5")
  assert.equal(formatCalculatorNumber(2000), "2000")
  assert.equal(formatCalculatorNumber(NaN), "0")
  assert.equal(formatCalculatorNumber(Infinity), "0")
})

console.log(`\n${passed} pruebas OK`)
