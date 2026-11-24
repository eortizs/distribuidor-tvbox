"use client"

import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import {
  ArrowRightIcon,
  CircleCheckIcon,
  LandmarkIcon,
  WalletIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/reui/badge"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTrigger,
} from "@/components/reui/stepper"
import { formatClabe } from "@/lib/clabe"
import {
  saveBusinessBankingAction,
  saveBusinessMpTokenAction,
  saveBusinessWhatsappNumberAction,
  type BusinessSetupState,
} from "@/app/actions/onboarding"

/**
 * Asistente de configuración del negocio (§4.3 del plan): UN paso por
 * pantalla, acción primaria a la derecha («Continuar»), «Saltar por ahora» a
 * la izquierda. Todo paso se salta; lo saltado queda pendiente en la tarjeta
 * «Primeros pasos» de /clientes y /onboarding sigue siendo la pantalla de
 * edición una vez completo.
 */

export interface OnboardingWizardProps {
  businessName: string
  slug: string
  baseHost: string
  steps: { mpToken: boolean; banking: boolean; whatsapp: boolean }
  ownerFullName: string
  banking: { bankName: string; bankHolder: string; bankClabe: string }
  token: { nickname: string | null; last4: string; status: "active" | "invalid" } | null
  whatsappNumber: string | null
  whatsappLinked: boolean
  referralUrl: string | null
  initialStep: number
}

const STEP_LABELS = ["Bienvenida", "Mercado Pago", "Cuenta de cobro", "WhatsApp"]
const INPUT_CLASS = "h-10 w-full rounded-lg px-3 text-base md:text-sm"
const FIELD_ERROR_CLASS = "text-destructive text-xs font-medium"

const INITIAL_ACTION_STATE: BusinessSetupState = { error: null, success: null }

export function OnboardingWizard(props: OnboardingWizardProps) {
  const router = useRouter()
  const firstPending = !props.steps.mpToken ? 1 : !props.steps.banking ? 2 : 3
  const [step, setStep] = useState(
    props.initialStep >= 0 && props.initialStep <= 4
      ? props.initialStep
      : props.steps.mpToken && props.steps.banking && props.steps.whatsapp
        ? 4
        : 0
  )

  /** Guarda bien → refresca el RSC (flags nuevos) y avanza de pantalla. */
  const advance = (next: number) => {
    router.refresh()
    setStep(next)
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8 md:py-12">
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Configuración de tu negocio
        </span>
        <h1 className="text-xl font-semibold tracking-tight">
          {props.businessName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {props.slug}.{props.baseHost}
        </p>
      </header>

      <Stepper
        value={step + 1}
        onValueChange={(value) => setStep(value - 1)}
        className="self-center"
        aria-label="Progreso de la configuración"
      >
        <StepperNav className="w-full max-w-md">
          {STEP_LABELS.map((label, index) => (
            <StepperItem key={label} step={index + 1} className="min-w-0">
              <StepperTrigger className="min-h-11 gap-1.5">
                <StepperIndicator>{index + 1}</StepperIndicator>
                <span className="hidden truncate text-xs font-medium sm:inline">
                  {label}
                </span>
              </StepperTrigger>
              {index < STEP_LABELS.length - 1 && <StepperSeparator />}
            </StepperItem>
          ))}
        </StepperNav>
      </Stepper>

      {step === 0 && (
        <WelcomePanel
          props={props}
          onContinue={() => setStep(firstPending)}
        />
      )}
      {step === 1 && (
        <MpTokenPanel props={props} onDone={() => advance(2)} />
      )}
      {step === 2 && (
        <BankingPanel props={props} onDone={() => advance(3)} />
      )}
      {step === 3 && (
        <WhatsappPanel props={props} onDone={() => advance(4)} />
      )}
      {step === 4 && <DonePanel props={props} />}
    </div>
  )
}

type PanelProps = { props: OnboardingWizardProps; onDone: () => void }

function WelcomePanel({
  props,
  onContinue,
}: {
  props: OnboardingWizardProps
  onContinue: () => void
}) {
  const complete =
    props.steps.mpToken && props.steps.banking && props.steps.whatsapp
  return (
    <Frame variant="inverse">
      <FramePanel>
        <FrameHeader>
          <FrameTitle className="text-base">
            Bienvenido a tu panel, {props.businessName}
          </FrameTitle>
          <FrameDescription>
            Configura tres cosas y tu negocio queda listo para cobrar:
            conecta tu cuenta de Mercado Pago, elige la cuenta donde recibes
            los pagos y vincula el WhatsApp de tu negocio.
          </FrameDescription>
        </FrameHeader>
        <div className="flex flex-col gap-2 pb-1">
          <StepRow
            done={props.steps.mpToken}
            label="Conecta tu cuenta de Mercado Pago"
            description="Para confirmar cada pago automáticamente."
          />
          <StepRow
            done={props.steps.banking}
            label="Cuenta donde recibes"
            description="La CLABE donde entra tu dinero."
          />
          <StepRow
            done={props.steps.whatsapp}
            label="WhatsApp de tu negocio"
            description="Para avisar a tus clientes de cada pago."
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={onContinue} size="lg" className="px-4">
            {complete ? "Revisar configuración" : "Comenzar"}
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </FramePanel>
    </Frame>
  )
}

function StepRow({
  done,
  label,
  description,
}: {
  done: boolean
  label: string
  description: string
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <span
        className={
          done
            ? "bg-primary text-primary-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
            : "text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
        }
        aria-hidden="true"
      >
        {done ? "✓" : "·"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  )
}

function MpTokenPanel({ props, onDone }: PanelProps) {
  const [mode, setMode] = useState<"have" | "need">("have")
  const [state, formAction, pending] = useActionState<BusinessSetupState, FormData>(
    saveBusinessMpTokenAction,
    INITIAL_ACTION_STATE
  )

  if (props.token && props.token.status === "active") {
    return (
      <Frame variant="inverse">
        <FramePanel>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2 text-base">
              <WalletIcon className="size-5" aria-hidden="true" />
              Conecta tu cuenta de Mercado Pago
            </FrameTitle>
            <FrameDescription>
              Puedes reemplazarla cuando quieras pegando otro token de
              producción (aquí mismo o en Perfil → Cuenta propia).
            </FrameDescription>
          </FrameHeader>
          <div className="flex flex-col gap-3 pb-1">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
              <CircleCheckIcon
                className="text-primary size-5 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {props.token.nickname ?? "Cuenta de Mercado Pago"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Terminación {props.token.last4}
                </p>
              </div>
              <Badge variant="success-light" size="sm" className="ml-auto">
                Conectada
              </Badge>
            </div>
            <ReplaceTokenForm onDone={onDone} />
          </div>
        </FramePanel>
      </Frame>
    )
  }

  return (
    <Frame variant="inverse">
      <FramePanel>
        <FrameHeader>
          <FrameTitle className="flex items-center gap-2 text-base">
            <WalletIcon className="size-5" aria-hidden="true" />
            Conecta tu cuenta de Mercado Pago
          </FrameTitle>
          <FrameDescription>
            {props.token && props.token.status === "invalid"
              ? "El token registrado quedó inválido: vincula uno nuevo."
              : "El sistema confirma cada depósito leyendo TU cuenta de Mercado Pago. Tu dinero nunca pasa por SPEILink."}
          </FrameDescription>
        </FrameHeader>
        <div className="flex flex-col gap-3 pb-1">
          <div
            className="flex gap-2"
            role="tablist"
            aria-label="¿Ya tienes cuenta de Mercado Pago?"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "have"}
              onClick={() => setMode("have")}
              className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors aria-selected:border-primary aria-selected:bg-primary/10"
            >
              Ya tengo cuenta
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "need"}
              onClick={() => setMode("need")}
              className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors aria-selected:border-primary aria-selected:bg-primary/10"
            >
              Aún no tengo cuenta
            </button>
          </div>

          {mode === "have" ? (
            <form action={formAction} className="flex flex-col gap-2.5">
              <label htmlFor="mpToken" className="text-sm font-medium">
                Access token de producción
              </label>
              <Input
                id="mpToken"
                name="mpToken"
                type="password"
                required
                placeholder="APP-USR-…"
                className={INPUT_CLASS}
                aria-invalid={state.error ? true : undefined}
                autoComplete="off"
              />
              {state.error && <p className={FIELD_ERROR_CLASS}>{state.error}</p>}
              <p className="text-muted-foreground text-xs">
                Lo encuentras en tu cuenta de Mercado Pago → «Tus integraciones»
                → «Credenciales de producción». Se guarda cifrado y jamás se
                vuelve a mostrar.
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onDone}
                  size="lg"
                  className="text-muted-foreground px-3"
                >
                  Saltar por ahora
                </Button>
                <Button type="submit" disabled={pending} size="lg" className="px-4">
                  {pending ? "Validando…" : "Conectar y continuar"}
                  <ArrowRightIcon className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2.5">
              <ol className="flex flex-col gap-2 text-sm">
                {[
                  "Entra a mercadopago.com.mx y crea tu cuenta gratis (5 minutos, con tu INE).",
                  "Dentro de tu cuenta, ve a «Tus integraciones» y crea una aplicación.",
                  "Copia tu access token de PRODUCCIÓN y pégalo en «Ya tengo cuenta».",
                ].map((text, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span className="text-muted-foreground leading-relaxed">
                      {text}
                    </span>
                  </li>
                ))}
              </ol>
              {props.referralUrl && (
                <a
                  href={props.referralUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary/10 text-primary hover:bg-primary/15 focus-visible:ring-ring inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2"
                >
                  Abrir mi cuenta de Mercado Pago
                </a>
              )}
              <Button
                variant="outline"
                onClick={() => setMode("have")}
                size="lg"
                className="px-4"
              >
                Ya la tengo: conectar
              </Button>
            </div>
          )}
        </div>
      </FramePanel>
    </Frame>
  )
}

/** Reemplazo del token dentro del panel «ya conectada». */
function ReplaceTokenForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<BusinessSetupState, FormData>(
    saveBusinessMpTokenAction,
    INITIAL_ACTION_STATE
  )
  return (
    <>
      {open ? (
        <form action={formAction} className="flex flex-col gap-2.5">
          <label htmlFor="mpTokenReplace" className="text-sm font-medium">
            Nuevo access token de producción
          </label>
          <Input
            id="mpTokenReplace"
            name="mpToken"
            type="password"
            required
            placeholder="APP-USR-…"
            className={INPUT_CLASS}
            aria-invalid={state.error ? true : undefined}
            autoComplete="off"
          />
          {state.error && <p className={FIELD_ERROR_CLASS}>{state.error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="text-muted-foreground px-3"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} size="sm" className="px-3">
              {pending ? "Validando…" : "Guardar"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-muted-foreground text-xs">
          Puedes reemplazarla en cualquier momento pegando otro token de
          producción.
        </p>
      )}
      {!open && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setOpen(true)}
            className="text-muted-foreground px-3"
          >
            Reemplazar token
          </Button>
          <Button onClick={onDone} size="lg" className="px-4">
            Continuar
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </>
  )
}

function BankingPanel({ props, onDone }: PanelProps) {
  const [state, formAction, pending] = useActionState<BusinessSetupState, FormData>(
    saveBusinessBankingAction,
    INITIAL_ACTION_STATE
  )
  return (
    <Frame variant="inverse">
      <FramePanel>
        <FrameHeader>
          <FrameTitle className="flex items-center gap-2 text-base">
            <LandmarkIcon className="size-5" aria-hidden="true" />
            Cuenta donde recibes los pagos
          </FrameTitle>
          <FrameDescription>
            Esta CLABE es la que les damos a tus clientes para pagarte. Para
            que la confirmación sea automática, debe ser la CLABE de tu cuenta
            de Mercado Pago (la encuentras en el perfil de tu app).
          </FrameDescription>
        </FrameHeader>
        <form action={formAction} className="flex flex-col gap-3 pb-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bankName" className="text-sm font-medium">
              Banco
            </label>
            <Input
              id="bankName"
              name="bankName"
              required
              maxLength={60}
              defaultValue={props.banking.bankName || "Mercado Pago"}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bankHolder" className="text-sm font-medium">
              Titular de la cuenta
            </label>
            <Input
              id="bankHolder"
              name="bankHolder"
              required
              maxLength={100}
              defaultValue={props.banking.bankHolder || props.ownerFullName}
              placeholder="Como aparece en la cuenta"
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bankClabe" className="text-sm font-medium">
              CLABE (18 dígitos)
            </label>
            <Input
              id="bankClabe"
              name="bankClabe"
              required
              inputMode="numeric"
              placeholder="000 000 000 000 000 000"
              defaultValue={
                props.banking.bankClabe ? formatClabe(props.banking.bankClabe) : ""
              }
              onInput={(e) => {
                e.currentTarget.value = formatClabe(e.currentTarget.value)
              }}
              className={`${INPUT_CLASS} font-mono tracking-wide`}
              aria-invalid={state.error ? true : undefined}
            />
            {state.error && <p className={FIELD_ERROR_CLASS}>{state.error}</p>}
            <p className="text-muted-foreground text-xs">
              Se guarda sin espacios; agrupamos solo mientras escribes.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onDone}
              size="lg"
              className="text-muted-foreground px-3"
            >
              Saltar por ahora
            </Button>
            <Button type="submit" disabled={pending} size="lg" className="px-4">
              {pending ? "Guardando…" : "Guardar y continuar"}
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      </FramePanel>
    </Frame>
  )
}

function WhatsappPanel({ props, onDone }: PanelProps) {
  const [state, formAction, pending] = useActionState<BusinessSetupState, FormData>(
    saveBusinessWhatsappNumberAction,
    INITIAL_ACTION_STATE
  )
  const declared = props.whatsappNumber !== null
  return (
    <Frame variant="inverse">
      <FramePanel>
        <FrameHeader>
          <FrameTitle className="flex items-center gap-2 text-base">
            WhatsApp de tu negocio
          </FrameTitle>
          <FrameDescription>
            {declared
              ? `Número declarado: +${props.whatsappNumber}. Vincúlalo por QR o código de emparejamiento en Módulos → WhatsApp.`
              : "Declara el número de WhatsApp con el que tu negocio avisa a sus clientes. La vinculación por QR vive en Módulos → WhatsApp."}
          </FrameDescription>
        </FrameHeader>
        <form action={formAction} className="flex flex-col gap-3 pb-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="whatsappNumber" className="text-sm font-medium">
              Número con código de país
            </label>
            <Input
              id="whatsappNumber"
              name="whatsappNumber"
              required
              inputMode="tel"
              placeholder="52 55 1234 5678"
              defaultValue={props.whatsappNumber ?? ""}
              className={INPUT_CLASS}
              aria-invalid={state.error ? true : undefined}
              autoComplete="off"
            />
            {state.error && <p className={FIELD_ERROR_CLASS}>{state.error}</p>}
            {state.needsReplaceConfirm && (
              <label className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  name="confirmReplace"
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>
                  Confirmo cambiar el WhatsApp del negocio: la sesión actual se
                  desvincula y habrá que escanear un QR nuevo.
                </span>
              </label>
            )}
            {state.success && (
              <p className="text-success text-xs font-medium">{state.success}</p>
            )}
            <p className="text-muted-foreground text-xs">
              Un número solo puede pertenecer a un negocio. Para cambiarlo
              después, desvincula primero desde Módulos → WhatsApp.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onDone}
              size="lg"
              className="text-muted-foreground px-3"
            >
              Saltar por ahora
            </Button>
            <Button type="submit" disabled={pending} size="lg" className="px-4">
              {pending ? "Guardando…" : "Guardar y continuar"}
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      </FramePanel>
    </Frame>
  )
}

function DonePanel({ props }: { props: OnboardingWizardProps }) {
  const complete =
    props.steps.mpToken && props.steps.banking && props.steps.whatsapp
  return (
    <Frame variant="inverse">
      <FramePanel>
        <FrameHeader>
          <FrameTitle className="flex items-center gap-2 text-base">
            <CircleCheckIcon className="text-primary size-5" aria-hidden="true" />
            {complete ? "Todo listo" : "Configuración guardada"}
          </FrameTitle>
          <FrameDescription>
            {complete
              ? "Tu negocio está listo para cobrar. Crea tu primer link de pago y compártelo por WhatsApp: la confirmación del depósito llega sola."
              : "Guardamos lo que configuraste. Lo pendiente aparece como «Primeros pasos» en tu panel y puedes completarlo aquí cuando quieras."}
          </FrameDescription>
        </FrameHeader>
        <div className="flex items-center justify-end gap-2 pt-1 pb-1">
          <Button render={<a href="/modulos/links-de-pago" />} size="lg" className="px-4">
            Crear mi primer link de pago
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </FramePanel>
    </Frame>
  )
}
