"use client"

import { useCallback, useMemo, useState } from "react"
import { CheckIcon, CopyIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RENEWAL_MONTHS, type RenewalMonths } from "@/lib/flujotv"

import { renewFlujoLicense } from "./flujo-api"
import { JsonViewer } from "./json-viewer"

function newIdempotencyKey(): string {
  return `lab-${crypto.randomUUID()}`
}

interface RenovacionPanelProps {
  /** Usuario preseleccionado desde la tabla de clientes. */
  target: string
  onRenewed: () => void
}

export function RenovacionPanel({ target, onRenewed }: RenovacionPanelProps) {
  const [userName, setUserName] = useState(target)
  const [months, setMonths] = useState<RenewalMonths>(1)
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // La clave de idempotencia está atada al payload: si cambian el usuario o
  // los meses, la clave cambia con ellos. Repetir el MISMO payload con la
  // MISMA clave devuelve la misma renovación en lugar de cobrarla dos veces.
  const changeUserName = useCallback((value: string) => {
    setUserName(value)
    setIdempotencyKey(newIdempotencyKey())
  }, [])

  const changeMonths = useCallback((value: RenewalMonths) => {
    setMonths(value)
    setIdempotencyKey(newIdempotencyKey())
  }, [])

  const canSubmit = userName.trim().length > 0

  async function submitRenewal() {
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const response = await renewFlujoLicense({
        userName: userName.trim(),
        months,
        idempotencyKey,
      })
      setResult(response.payload)
      toast.success("Renovación registrada", {
        description: `${userName.trim()} · ${months} ${
          months === 1 ? "mes" : "meses"
        }`,
      })
      onRenewed()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar la renovación."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(idempotencyKey)
      toast.success("Clave de idempotencia copiada")
    } catch {
      toast.error("El navegador no permitió copiar la clave.")
    }
  }

  const monthsLabel = useMemo(
    () => (months === 1 ? "1 mes" : `${months} meses`),
    [months]
  )

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>Esta operación renueva una licencia real</AlertTitle>
        <AlertDescription>
          <p>
            La renovación extiende la licencia en el panel de FlujoTV y cuenta
            meses reales. No la uses como prueba: elige el cliente correcto y
            los meses que realmente vas a cobrar.
          </p>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="renovacion-usuario">Usuario</FieldLabel>
          <Input
            id="renovacion-usuario"
            value={userName}
            onChange={(event) => changeUserName(event.target.value)}
            placeholder="nombre_de_usuario"
            autoComplete="off"
            required
          />
          <FieldDescription>
            El nombre de usuario tal y como aparece en el panel.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Meses</FieldLabel>
          <Select
            value={String(months)}
            onValueChange={(value) =>
              changeMonths(Number(value ?? "1") as RenewalMonths)
            }
          >
            <SelectTrigger className="w-full" aria-label="Meses a renovar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RENEWAL_MONTHS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option === 1 ? "1 mes" : `${option} meses`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            El panel solo admite renovaciones de 1, 3, 6 o 12 meses.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="renovacion-idempotencia">
          Clave de idempotencia
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="renovacion-idempotencia"
            value={idempotencyKey}
            readOnly
            className="font-mono"
            aria-describedby="renovacion-idempotencia-help"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => void copyKey()}
            aria-label="Copiar la clave de idempotencia"
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </div>
        <FieldDescription id="renovacion-idempotencia-help">
          Cambia sola cuando cambian el usuario o los meses. Repetir el mismo
          payload con la misma clave devuelve la misma renovación sin cobrarla
          dos veces.
        </FieldDescription>
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!canSubmit || submitting}
        >
          <KeyRoundIcon aria-hidden="true" />
          Renovar licencia
        </Button>
        {userName.trim().length > 0 ? (
          <Badge variant="info-light" size="sm">
            {userName.trim()} · {monthsLabel}
          </Badge>
        ) : null}
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>La renovación no se completó</AlertTitle>
          <AlertDescription>
            <p>{errorMessage}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {result !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CheckIcon aria-hidden="true" className="text-success" />
            <h3 className="text-sm font-semibold tracking-tight">
              Respuesta de la API
            </h3>
          </div>
          <JsonViewer value={result} />
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar la renovación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se renovará la licencia de {userName.trim() || "—"} durante{" "}
              {monthsLabel}. La operación queda registrada en el panel de
              FlujoTV y no se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void submitRenewal()
              }}
              disabled={submitting}
            >
              {submitting ? "Renovando…" : "Confirmar renovación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
