"use client"

import { useReducer } from "react"
import {
  DeleteIcon,
  DivideIcon,
  EqualIcon,
  MinusIcon,
  PercentIcon,
  PlusIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  calculatorExpression,
  calculatorPreview,
  calculatorReducer,
  createInitialCalculatorState,
  formatCalculatorEntryText,
  type CalculatorAction,
  type CalculatorOperator,
} from "@/lib/calculadora"

interface CalculatorKey {
  id: string
  /** Contenido visible cuando no es icono. */
  label?: string
  icon?: LucideIcon
  /** Nombre accesible en español para iconos y símbolos. */
  ariaLabel?: string
  variant: "default" | "secondary" | "outline" | "ghost"
  action: CalculatorAction
}

/** Teclado de cuatro columnas; el orden llena la retícula por filas. */
const KEYS: CalculatorKey[] = [
  { id: "clear", label: "C", ariaLabel: "Limpiar", variant: "outline", action: { type: "clear" } },
  {
    id: "backspace",
    icon: DeleteIcon,
    ariaLabel: "Borrar último dígito",
    variant: "outline",
    action: { type: "backspace" },
  },
  {
    id: "percent",
    icon: PercentIcon,
    ariaLabel: "Porcentaje",
    variant: "outline",
    action: { type: "percent" },
  },
  {
    id: "divide",
    icon: DivideIcon,
    ariaLabel: "División",
    variant: "outline",
    action: { type: "operator", operator: "/" satisfies CalculatorOperator },
  },
  { id: "7", label: "7", variant: "secondary", action: { type: "digit", digit: "7" } },
  { id: "8", label: "8", variant: "secondary", action: { type: "digit", digit: "8" } },
  { id: "9", label: "9", variant: "secondary", action: { type: "digit", digit: "9" } },
  {
    id: "multiply",
    icon: XIcon,
    ariaLabel: "Multiplicación",
    variant: "outline",
    action: { type: "operator", operator: "*" satisfies CalculatorOperator },
  },
  { id: "4", label: "4", variant: "secondary", action: { type: "digit", digit: "4" } },
  { id: "5", label: "5", variant: "secondary", action: { type: "digit", digit: "5" } },
  { id: "6", label: "6", variant: "secondary", action: { type: "digit", digit: "6" } },
  {
    id: "subtract",
    icon: MinusIcon,
    ariaLabel: "Resta",
    variant: "outline",
    action: { type: "operator", operator: "-" satisfies CalculatorOperator },
  },
  { id: "1", label: "1", variant: "secondary", action: { type: "digit", digit: "1" } },
  { id: "2", label: "2", variant: "secondary", action: { type: "digit", digit: "2" } },
  { id: "3", label: "3", variant: "secondary", action: { type: "digit", digit: "3" } },
  {
    id: "add",
    icon: PlusIcon,
    ariaLabel: "Suma",
    variant: "outline",
    action: { type: "operator", operator: "+" satisfies CalculatorOperator },
  },
  {
    id: "sign",
    label: "±",
    ariaLabel: "Cambio de signo",
    variant: "outline",
    action: { type: "sign" },
  },
  { id: "0", label: "0", variant: "secondary", action: { type: "digit", digit: "0" } },
  {
    id: "decimal",
    label: ".",
    ariaLabel: "Punto decimal",
    variant: "secondary",
    action: { type: "decimal" },
  },
  {
    id: "equals",
    icon: EqualIcon,
    ariaLabel: "Resultado",
    variant: "default",
    action: { type: "equals" },
  },
]

function actionFromKey(key: string): CalculatorAction | null {
  if (/^[0-9]$/.test(key)) return { type: "digit", digit: key }
  switch (key) {
    case ".":
    case ",":
      return { type: "decimal" }
    case "+":
      return { type: "operator", operator: "+" }
    case "-":
      return { type: "operator", operator: "-" }
    case "*":
      return { type: "operator", operator: "*" }
    case "/":
      return { type: "operator", operator: "/" }
    case "%":
      return { type: "percent" }
    case "Enter":
    case "=":
      return { type: "equals" }
    case "Backspace":
      return { type: "backspace" }
    case "Escape":
    case "Delete":
      return { type: "clear" }
    default:
      return null
  }
}

const HELP_ID = "calculadora-ayuda"

/**
 * Herramienta Calculadora: una sola Card con pantalla grande y teclado de
 * cuatro columnas circular, adaptable al espacio disponible entre la
 * cabecera y la barra inferior. Todo el cálculo ocurre en el navegador; el
 * manejo por teclado queda limitado al área de la calculadora.
 */
export function Calculadora() {
  const [state, dispatch] = useReducer(
    calculatorReducer,
    undefined,
    createInitialCalculatorState
  )
  const expression = calculatorExpression(state)
  const preview = calculatorPreview(state)
  // Línea grande: la operación mientras se construye; tras `=` (o sin
  // operación), la entrada o resultado con millares agrupados.
  const idleText = state.error ?? formatCalculatorEntryText(state.display)
  const displaySize = idleText.length > 16
    ? "text-xl sm:text-2xl"
    : idleText.length > 11
      ? "text-2xl sm:text-3xl"
      : idleText.length > 6
        ? "text-4xl sm:text-5xl"
        : "text-6xl sm:text-7xl"
  const operationSize = expression !== null
    ? expression.length > 16
      ? "text-xl sm:text-2xl"
      : expression.length > 11
        ? "text-2xl sm:text-3xl"
        : expression.length > 6
          ? "text-3xl sm:text-4xl"
          : "text-4xl sm:text-5xl"
    : ""

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Sin atajos con modificadores. Con un botón enfocado solo se omite lo
    // que ya activa el botón por sí mismo (Enter/Espacio): el resto de
    // teclas se manejan aquí sin duplicar la acción.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest("button") &&
      (event.key === "Enter" || event.key === " ")
    ) {
      return
    }
    const action = actionFromKey(event.key)
    if (!action) return
    event.preventDefault()
    dispatch(action)
  }

  return (
    <div
      className="flex h-full min-h-0 w-full [container-type:size]"
      onKeyDown={handleKeyDown}
    >
    <Card className="min-h-0 min-w-0 flex-1 ring-0">
      <CardContent className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(13rem,1fr)_auto] gap-4 [--calculator-key-size:max(2.75rem,min(calc((100cqw-4.25rem)/4),calc((100cqh-19rem)/5),6rem))]">
        <p aria-live="polite" role="status" className="sr-only">
          {state.announce}
        </p>
        <div
          role="region"
          aria-label="Pantalla de la calculadora"
          aria-describedby={HELP_ID}
          tabIndex={0}
          className="flex min-w-0 flex-col justify-end gap-2 rounded-lg bg-muted/50 px-4 py-4 text-right outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {expression !== null ? (
            <div
              aria-hidden="true"
              className={cn(
                "min-w-0 overflow-x-auto whitespace-nowrap font-medium tracking-tight tabular-nums leading-tight [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                operationSize
              )}
            >
              {expression}
            </div>
          ) : null}
          <div
            className={cn(
              "min-w-0 tabular-nums [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              expression !== null
                ? "overflow-x-auto whitespace-nowrap text-xl sm:text-2xl text-muted-foreground"
                : cn(
                    displaySize,
                    "overflow-x-auto whitespace-nowrap font-medium leading-tight tracking-tight",
                    state.error &&
                      "text-destructive text-base leading-6 sm:text-lg"
                  )
            )}
          >
            {expression !== null ? (preview ?? "") : idleText}
          </div>
        </div>
        <div
          className="grid grid-cols-4 justify-items-center gap-3"
          aria-label="Teclado de la calculadora"
          role="group"
        >
          {KEYS.map((key) => (
            <Button
              key={key.id}
              type="button"
              variant={key.variant}
              size="icon-lg"
              className="size-[var(--calculator-key-size)] rounded-full text-3xl font-normal"
              aria-label={key.ariaLabel ?? key.label}
              onClick={() => dispatch(key.action)}
            >
              {key.icon ? <key.icon className="size-7" aria-hidden="true" /> : key.label}
            </Button>
          ))}
        </div>
        <span id={HELP_ID} className="sr-only">
          Con el foco en la calculadora también funciona el teclado: números,
          + − * / %, Enter para el resultado, Retroceso para borrar y Esc para
          limpiar. Con + o −, el porcentaje se calcula sobre el primer número.
        </span>
      </CardContent>
    </Card>
    </div>
  )
}
