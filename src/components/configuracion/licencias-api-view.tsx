"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  clearFlujoApiKeyAction,
  licenciasApiAction,
  type LicenciasApiState,
} from "@/app/actions/licencias"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { FlujoHealth, FlujoKeySource } from "@/lib/flujotv"

const initialState: LicenciasApiState = {
  error: null,
  success: null,
  warning: null,
  saved: false,
  intent: null,
}

const SOURCE_LABEL: Record<Exclude<FlujoKeySource, null>, string> = {
  ajustes: "Guardada en el panel",
  env: "Variable FLUJO_API_KEY",
  file: "Fichero FLUJO_API_KEY_FILE",
}

export interface LicenciasApiViewProps {
  configured: boolean
  keySource: FlujoKeySource
  maskedKey: string | null
  baseUrl: string
  updatedAt: string | null
  health: FlujoHealth
  isAdmin: boolean
}

export function LicenciasApiView({
  configured,
  keySource,
  maskedKey,
  baseUrl,
  updatedAt,
  health,
  isAdmin,
}: LicenciasApiViewProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    licenciasApiAction,
    initialState
  )
  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [clearOpen, setClearOpen] = useState(false)
  const [isClearing, startClearing] = useTransition()

  useEffect(() => {
    if (!state.success) return
    toast.success(state.success)
    // El refresh solo hace falta tras guardar (cambia el estado). Al probar,
    // la clave escrita debe seguir ahí: React vacía los campos no controlados
    // al terminar una server action, por eso el campo va controlado.
    if (state.saved) router.refresh()
  }, [state.success, state.saved, router])

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  function deactivate() {
    startClearing(async () => {
      const result = await clearFlujoApiKeyAction()
      if (result.success) {
        toast.success(result.success)
        router.refresh()
      } else if (result.error) {
        toast.error(result.error)
      }
      setClearOpen(false)
    })
  }

  const savedInPanel = keySource === "ajustes"

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Estado</CardTitle>
            {configured ? (
              <Badge variant="success-light" size="sm">
                <CircleCheckIcon aria-hidden="true" />
                Módulo activo
              </Badge>
            ) : (
              <Badge variant="warning-light" size="sm">
                <TriangleAlertIcon aria-hidden="true" />
                Sin activar
              </Badge>
            )}
          </div>
          <CardDescription className="text-sm">
            La clave se usa solo en el servidor: el navegador recibe un
            identificador parcial y nunca el valor completo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Clave">
            <span className="font-mono text-xs">
              {maskedKey ?? "Sin configurar"}
            </span>
          </Fact>
          <Fact label="Origen">
            {keySource ? SOURCE_LABEL[keySource] : "—"}
          </Fact>
          <Fact label="URL base">
            <span className="font-mono text-xs break-all">{baseUrl}</span>
          </Fact>
          <Fact label="Última actualización">
            {updatedAt
              ? new Intl.DateTimeFormat("es", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(updatedAt))
              : "—"}
          </Fact>
          <Fact label="Salud del servicio">
            {health.reachable ? (
              <Badge variant="success-light" size="sm">
                <CircleCheckIcon aria-hidden="true" />
                {health.status ?? "ok"}
                {health.version ? ` · v${health.version}` : ""}
              </Badge>
            ) : (
              <Badge variant="destructive-light" size="sm">
                <CircleXIcon aria-hidden="true" />
                Sin respuesta
              </Badge>
            )}
          </Fact>
          <Fact label="Módulo">
            <Button
              variant="outline"
              size="xs"
              nativeButton={false}
              render={<Link href="/lab/flujotv" />}
            >
              Abrir API FlujoTV
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </Fact>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activar el módulo de licencias</CardTitle>
          <CardDescription className="text-sm">
            Escribe la clave de la API de FlujoTV. Al guardarla se comprueba
            contra el servicio y queda cifrada en la base de datos del panel.
          </CardDescription>
        </CardHeader>

        {isAdmin ? (
          <form action={formAction} className="flex flex-col">
            <CardContent className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="licencias-base-url">URL base</FieldLabel>
                <Input
                  id="licencias-base-url"
                  name="baseUrl"
                  defaultValue={baseUrl}
                  className="font-mono"
                  spellCheck={false}
                />
                <FieldDescription>
                  Servicio de la API de licencias (por defecto{" "}
                  <span className="font-mono">
                    https://api.eortizs.people-negocios.com
                  </span>
                  ).
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="licencias-api-key">
                  Clave de API
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="licencias-api-key"
                    name="apiKey"
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="fltv1_…"
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={
                      showKey
                        ? "Ocultar la clave de API"
                        : "Mostrar la clave de API"
                    }
                    onClick={() => setShowKey((visible) => !visible)}
                  >
                    {showKey ? (
                      <EyeOffIcon aria-hidden="true" />
                    ) : (
                      <EyeIcon aria-hidden="true" />
                    )}
                  </Button>
                </div>
                <FieldDescription>
                  Se envía únicamente en el header{" "}
                  <span className="font-mono">X-API-Key</span> y se guarda
                  cifrada. Nunca se escribe en una URL ni se registra.
                </FieldDescription>
              </Field>

              {state.warning ? (
                <Alert variant="warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertTitle>Guardado con aviso</AlertTitle>
                  <AlertDescription>
                    <p>{state.warning}</p>
                  </AlertDescription>
                </Alert>
              ) : null}
              {state.error ? (
                <Alert variant="destructive" role="alert">
                  <CircleXIcon aria-hidden="true" />
                  <AlertTitle>
                    {state.intent === "test"
                      ? "No se pudo comprobar la clave"
                      : "No se pudo guardar"}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{state.error}</p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>

            <CardFooter className="flex flex-wrap items-center gap-2 pt-3">
              <Button
                type="submit"
                name="intent"
                value="save"
                size="sm"
                disabled={isPending}
              >
                <ShieldCheckIcon aria-hidden="true" />
                {isPending ? "Guardando…" : "Guardar y activar"}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="test"
                size="sm"
                variant="outline"
                disabled={isPending}
              >
                Probar conexión
              </Button>
              {savedInPanel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setClearOpen(true)}
                  disabled={isPending || isClearing}
                >
                  Desactivar
                </Button>
              ) : null}
            </CardFooter>
          </form>
        ) : (
          <CardContent className="flex flex-col gap-3">
            <Alert>
              <KeyRoundIcon aria-hidden="true" />
              <AlertTitle>Solo un administrador cambia la clave</AlertTitle>
              <AlertDescription>
                <p>
                  La clave es del panel y la usa todo el equipo. Pide a un
                  administrador que la active en esta sección.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar la API de licencias?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina la clave guardada en el panel y el módulo vuelve a la
              clave del entorno del servidor, si la hay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                deactivate()
              }}
              disabled={isClearing}
            >
              {isClearing ? "Desactivando…" : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
