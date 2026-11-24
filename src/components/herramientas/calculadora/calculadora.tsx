"use client"

import { useEffect, useReducer, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  BanknoteIcon,
  DeleteIcon,
  DivideIcon,
  EqualIcon,
  HistoryIcon,
  MinusIcon,
  PercentIcon,
  PlusIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { LinkCreadoDialog } from "@/components/herramientas/links-pago/link-creado-dialog"
import {
  calculatorExpression,
  calculatorPreview,
  calculatorReducer,
  createInitialCalculatorState,
  formatCalculatorEntryText,
  type CalculatorAction,
  type CalculatorHistoryEntry,
  type CalculatorOperator,
} from "@/lib/calculadora"
import {
  PAYMENT_ORDER_MAX_MXN,
  PAYMENT_ORDER_MIN_MXN,
  PAYMENT_ORDER_CONCEPTO_ERROR,
  normalizePaymentOrderConcepto,
} from "@/lib/links-pago"
import { createPaymentOrderAction, type CreatedPaymentOrder } from "@/app/actions/links-pago"

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

/*
 * Cinta de historial: cada `=` queda registrado en el dispositivo para que
 * el tendero consulte sus operaciones del día y reutilice un resultado.
 */

interface CintaEntrada {
  id: string
  expression: string
  result: string
  at: number
}

const CINTA_KEY = "calculadora:historial"
const CINTA_MAX = 50

const horaFormatter = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
})

/** Dinero para etiquetas cortas (`Cobrar $750.00`), sin la unidad. */
function moneyLabel(value: number): string {
  return `$${value.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function nuevoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function esCintaEntrada(value: unknown): value is CintaEntrada {
  if (typeof value !== "object" || value === null) return false
  const item = value as Partial<CintaEntrada>
  return (
    typeof item.id === "string" &&
    typeof item.expression === "string" &&
    typeof item.result === "string" &&
    typeof item.at === "number"
  )
}

interface CalculadoraProps {
  /** El módulo SPEILink está visible para esta cuenta. */
  puedeCobrar: boolean
  /** Hay número de agente de WhatsApp en el servidor. */
  whatsappConfigured: boolean
  /** La cuenta tiene datos bancarios completos para recibir el cobro. */
  bankConfigured: boolean
}

/**
 * Herramienta Calculadora: una sola Card con pantalla grande y teclado de
 * cuatro columnas circular, adaptable al espacio disponible entre la
 * cabecera y la barra inferior. Todo el cálculo ocurre en el navegador; el
 * manejo por teclado queda limitado al área de la calculadora. Bajo el
 * teclado, la cinta de historial y el cobro por link de pago.
 */
export function Calculadora({
  puedeCobrar,
  whatsappConfigured,
  bankConfigured,
}: CalculadoraProps) {
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

  // Cinta de historial: se hidrata del dispositivo, cada `=` agrega una
  // línea y cualquier cambio se persiste. El ref evita dobles ingresos del
  // mismo cierre (StrictMode re-ejecuta efectos con el mismo objeto) y
  // `cintaLista` evita que la persistencia borre lo guardado antes de que
  // la hidratación (microtarea) lo lea.
  const [cinta, setCinta] = useState<CintaEntrada[]>([])
  const [cintaLista, setCintaLista] = useState(false)
  const [cintaAbierta, setCintaAbierta] = useState(false)
  const [limpiarAbierto, setLimpiarAbierto] = useState(false)
  const lastCompletedRef = useRef<CalculatorHistoryEntry | null>(null)

  useEffect(() => {
    void Promise.resolve().then(() => {
      let cargada: CintaEntrada[] | null = null
      try {
        const raw = window.localStorage.getItem(CINTA_KEY)
        if (raw) {
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            cargada = parsed.filter(esCintaEntrada).slice(-CINTA_MAX)
          }
        }
      } catch {
        // Historial corrupto o no disponible: se empieza vacío.
      }
      if (cargada) setCinta(cargada)
      setCintaLista(true)
    })
  }, [])

  useEffect(() => {
    const entry = state.lastCompleted
    if (entry === null || lastCompletedRef.current === entry) return
    lastCompletedRef.current = entry
    setCinta((prev) => {
      const next: CintaEntrada[] = [
        ...prev,
        {
          id: nuevoId(),
          expression: entry.expression,
          result: entry.result,
          at: Date.now(),
        },
      ]
      return next.length > CINTA_MAX ? next.slice(-CINTA_MAX) : next
    })
  }, [state.lastCompleted])

  useEffect(() => {
    if (!cintaLista) return
    try {
      window.localStorage.setItem(CINTA_KEY, JSON.stringify(cinta))
    } catch {
      // Sin almacenamiento disponible: la cinta vive solo en memoria.
    }
  }, [cinta, cintaLista])

  // Cobro: el valor en pantalla se convierte en un link de pago con
  // confirmación previa (monto editable + concepto de pago obligatorio).
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [montoTexto, setMontoTexto] = useState("")
  const [referencia, setReferencia] = useState("")
  const [cobroError, setCobroError] = useState<string | null>(null)
  const [creada, setCreada] = useState<CreatedPaymentOrder | null>(null)
  const [creando, startCreando] = useTransition()

  const valorPantalla = Number(state.display)
  const cobroValido =
    Number.isFinite(valorPantalla) &&
    valorPantalla >= PAYMENT_ORDER_MIN_MXN &&
    valorPantalla <= PAYMENT_ORDER_MAX_MXN
  // Título del diálogo: sigue el importe editable; cae al valor de pantalla
  // mientras el texto aún no parsea a un monto positivo.
  const montoEditado = Number(montoTexto.replace(/[$,\s]/g, ""))
  const cobroTitulo =
    Number.isFinite(montoEditado) && montoEditado > 0
      ? moneyLabel(montoEditado)
      : moneyLabel(valorPantalla)
  const cobrarBloqueo = !whatsappConfigured
    ? "Vincula el WhatsApp de tu negocio en Módulos → WhatsApp para poder cobrar."
    : !bankConfigured
      ? "Completa tus datos bancarios en Perfil → Datos bancarios para recibir tus cobros."
      : null

  function abrirCobro() {
    setMontoTexto(state.display)
    setReferencia("")
    setCobroError(null)
    setCobroAbierto(true)
  }

  function submitCobro(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCobroError(null)
    const parsed = Number(montoTexto.replace(/[$,\s]/g, ""))
    if (!Number.isFinite(parsed) || parsed < PAYMENT_ORDER_MIN_MXN) {
      setCobroError(`El monto mínimo es $${PAYMENT_ORDER_MIN_MXN.toFixed(2)} MXN.`)
      return
    }
    if (parsed > PAYMENT_ORDER_MAX_MXN) {
      setCobroError(
        `El monto máximo es $${PAYMENT_ORDER_MAX_MXN.toLocaleString("es-MX")} MXN.`
      )
      return
    }
    if (!normalizePaymentOrderConcepto(referencia)) {
      setCobroError(PAYMENT_ORDER_CONCEPTO_ERROR)
      return
    }
    startCreando(async () => {
      const result = await createPaymentOrderAction({
        amountMxn: parsed,
        note: referencia,
      })
      if (result.error || !result.order) {
        setCobroError(result.error ?? "No se pudo crear el link de pago.")
        return
      }
      setCobroAbierto(false)
      setCreada(result.order)
      setReferencia("")
      toast.success(`Cobro ${result.order.code} listo para compartir`)
    })
  }

  function recordarValor(entrada: CintaEntrada) {
    const value = Number(entrada.result.replace(/,/g, ""))
    if (!Number.isFinite(value)) return
    dispatch({ type: "recall", value })
    setCintaAbierta(false)
  }

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
      <CardContent className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(13rem,1fr)_auto_auto] gap-4 [--calculator-key-size:max(2.75rem,min(calc((100cqw-4.25rem)/4),calc((100cqh-22.5rem)/5),6rem))]">
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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Sheet open={cintaAbierta} onOpenChange={setCintaAbierta}>
              <SheetTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="shrink-0 bg-background px-4"
                  />
                }
              >
                <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                Historial
                {cinta.length > 0 ? (
                  <span className="ml-0.5 tabular-nums text-muted-foreground">
                    {cinta.length}
                  </span>
                ) : null}
              </SheetTrigger>
              <SheetContent side="bottom" className="mx-auto max-w-lg gap-0 rounded-t-xl">
                <SheetHeader className="pr-12">
                  <SheetTitle>Historial de cálculos</SheetTitle>
                  <SheetDescription>
                    Toca un resultado para usarlo en la calculadora.
                  </SheetDescription>
                </SheetHeader>
                {cinta.length === 0 ? (
                  <p className="px-4 pb-6 text-muted-foreground text-sm">
                    Sin operaciones todavía: cada «=» queda registrado aquí.
                  </p>
                ) : (
                  <>
                    <ul className="max-h-[45vh] overflow-y-auto px-2 pb-2">
                      {[...cinta].reverse().map((entrada) => (
                        <li key={entrada.id}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Usar el resultado ${entrada.result}`}
                            onClick={() => recordarValor(entrada)}
                          >
                            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                              {horaFormatter.format(new Date(entrada.at))}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm tabular-nums">
                              {entrada.expression} =
                            </span>
                            <span className="shrink-0 font-medium text-base tabular-nums">
                              {entrada.result}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t p-4 pt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="w-full text-destructive"
                        onClick={() => setLimpiarAbierto(true)}
                      >
                        Limpiar historial
                      </Button>
                    </div>
                  </>
                )}
              </SheetContent>
            </Sheet>
            {puedeCobrar ? (
              <Button
                type="button"
                size="lg"
                className="flex-1 px-4"
                disabled={!cobroValido}
                onClick={abrirCobro}
              >
                <BanknoteIcon data-icon="inline-start" aria-hidden="true" />
                {cobroValido ? `Cobrar ${moneyLabel(valorPantalla)}` : "Cobrar"}
              </Button>
            ) : null}
          </div>
          {puedeCobrar && cobrarBloqueo ? (
            <p className="text-muted-foreground text-xs">{cobrarBloqueo}</p>
          ) : null}
        </div>
        <span id={HELP_ID} className="sr-only">
          Con el foco en la calculadora también funciona el teclado: números,
          + − * / %, Enter para el resultado, Retroceso para borrar y Esc para
          limpiar. Con + o −, el porcentaje se calcula sobre el primer número.
        </span>
      </CardContent>
    </Card>

    {/* Confirmación del cobro: monto editable + referencia opcional */}
    <Dialog
      open={cobroAbierto}
      onOpenChange={(open) => {
        if (!open) setCobroAbierto(false)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cobrar {cobroTitulo}</DialogTitle>
          <DialogDescription>
            Se genera un link de pago: tu cliente lo abre, solicita el pago en
            el chat del agente y ahí recibe su concepto de pago para pagar por
            SPEI. Te llega la confirmación del cobro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submitCobro} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cobro-monto">Importe (MXN)</Label>
            <Input
              id="cobro-monto"
              inputMode="decimal"
              autoComplete="off"
              value={montoTexto}
              onChange={(event) => setMontoTexto(event.target.value)}
              disabled={creando}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cobro-referencia">Concepto de pago</Label>
            <Input
              id="cobro-referencia"
              autoComplete="off"
              maxLength={20}
              placeholder="Ej. VentaJuana"
              value={referencia}
              onChange={(event) => setReferencia(event.target.value)}
              disabled={creando}
            />
            <p className="text-muted-foreground text-xs">
              Una sola palabra alfanumérica, sin espacios ni caracteres
              especiales (3–20).
            </p>
          </div>
          {cobroError ? (
            <p className="text-destructive text-sm" role="alert">
              {cobroError}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={creando}
              onClick={() => setCobroAbierto(false)}
            >
              Volver
            </Button>
            <Button type="submit" size="lg" disabled={creando}>
              {creando ? "Creando…" : "Crear link de pago"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* QR y link del link de pago creado (componente compartido con SPEILink) */}
    <LinkCreadoDialog order={creada} onClose={() => setCreada(null)} />

    {/* Confirmación de limpiar la cinta */}
    <AlertDialog
      open={limpiarAbierto}
      onOpenChange={(open) => {
        if (!open) setLimpiarAbierto(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Limpiar el historial?</AlertDialogTitle>
          <AlertDialogDescription>
            Se borran las {cinta.length} operación{cinta.length === 1 ? "" : "es"}{" "}
            guardadas en este dispositivo. Los cobros ya creados no se afectan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Conservar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setCinta([])
              setLimpiarAbierto(false)
              setCintaAbierta(false)
            }}
          >
            Limpiar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  )
}
