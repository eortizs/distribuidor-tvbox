import { ArrowRightIcon } from "lucide-react"

/*
 * Lanzamiento (§4.6 del plan): `LAUNCH_ENABLED = false` mantiene TODOS los
 * CTAs deshabilitados en preventa (ningún enlace a /registro, /acceder ni
 * wa.me). Al abrir el servicio: activar `LAUNCH_ENABLED = true` + build para
 * publicar los CTAs (alta → /registro, sesión → /acceder) y definir
 * `SPEILINK_SUPPORT_WHATSAPP` (número del soporte, solo dígitos) para el CTA
 * del pie; sin ella el soporte sigue deshabilitado aunque el resto abra.
 *
 * NOTA: el alta REAL exige además `SELF_SIGNUP_ENABLED=on` en el servidor
 * (interruptor independiente del build; con la página de /registro apagada
 * muestra «Muy pronto»).
 */
export const LAUNCH_ENABLED = false

const SUPPORT_WHATSAPP =
  (process.env.SPEILINK_SUPPORT_WHATSAPP || "").replace(/\D/g, "") || null

const BASE_CTA_CLASS =
  "inline-flex items-center justify-center font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2"

const PRESALE_CLASS = "cursor-not-allowed opacity-65"

const VARIANT_CLASSES = {
  navbar:
    "min-h-11 shrink-0 whitespace-nowrap gap-1.5 rounded-xl bg-[#059669] px-3 text-sm text-white shadow-sm shadow-[#059669]/20 sm:px-4",
  hero: "min-h-13 w-full gap-2 rounded-xl bg-[#059669] px-6 text-base text-white shadow-lg shadow-[#059669]/25 sm:w-auto sm:min-w-[260px]",
  section:
    "min-h-12 w-full gap-2 rounded-xl bg-[#059669] px-6 text-base text-white shadow-md shadow-[#059669]/20 sm:w-auto sm:min-w-[250px]",
  banner:
    "min-h-13 w-full gap-2 rounded-xl bg-[#059669] px-7 text-base font-bold text-white shadow-lg shadow-black/25 focus-visible:ring-offset-[#0F172A] sm:w-auto sm:min-w-[280px]",
} as const

function CtaInner({ variant }: { variant: keyof typeof VARIANT_CLASSES }) {
  return (
    <>
      {variant === "navbar" ? (
        <>
          <span className="sm:hidden">Crear cuenta</span>
          <span className="hidden sm:inline">Crear mi cuenta gratis</span>
          <ArrowRightIcon className="hidden size-4 sm:inline" aria-hidden="true" />
        </>
      ) : (
        <>
          {variant === "banner" ? "Crear mi cuenta" : "Crear mi cuenta gratis"}
          <ArrowRightIcon className="size-4 shrink-0" aria-hidden="true" />
        </>
      )}
    </>
  )
}

/**
 * CTA de alta. En preventa es `<button disabled>` SIN destino (cero /registro
 * en el HTML); al lanzar enlaza a la página de registro del apex.
 */
export function PrimarySignupCta({
  variant,
  className,
}: {
  variant: "navbar" | "hero" | "section" | "banner"
  className?: string
}) {
  if (!LAUNCH_ENABLED) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={[
          BASE_CTA_CLASS,
          VARIANT_CLASSES[variant],
          PRESALE_CLASS,
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <CtaInner variant={variant} />
      </button>
    )
  }
  return (
    <a
      href="/registro"
      className={[
        BASE_CTA_CLASS,
        VARIANT_CLASSES[variant],
        "hover:bg-[#047857]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CtaInner variant={variant} />
    </a>
  )
}

/** «Iniciar sesión»: al lanzar lleva a /acceder (buscador de subdominio). */
export function NavbarLoginButton() {
  if (!LAUNCH_ENABLED) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-[#1E293B] opacity-65 focus-visible:outline-none sm:px-3.5"
      >
        Iniciar sesión
      </button>
    )
  }
  return (
    <a
      href="/acceder"
      className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-[#1E293B] transition-colors hover:text-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] sm:px-3.5"
    >
      Iniciar sesión
    </a>
  )
}

/** Soporte del pie: solo vivo con `SPEILINK_SUPPORT_WHATSAPP` definida. */
export function FooterSupportButton() {
  if (!LAUNCH_ENABLED || !SUPPORT_WHATSAPP) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="inline-flex min-h-11 cursor-not-allowed items-center text-sm font-medium text-slate-600 underline underline-offset-4 opacity-65 focus-visible:outline-none"
      >
        Soporte por WhatsApp
      </button>
    )
  }
  return (
    <a
      href={`https://wa.me/${SUPPORT_WHATSAPP}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-4 transition-colors hover:text-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]"
    >
      Soporte por WhatsApp
    </a>
  )
}

export function FloatingSignupCta() {
  if (!LAUNCH_ENABLED) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="relative hidden shrink-0 cursor-not-allowed items-center gap-1 whitespace-nowrap rounded-full px-1 text-xs font-bold text-emerald-300 focus-visible:outline-none disabled:opacity-90 after:absolute after:inset-0 after:-m-2 after:content-[''] sm:inline-flex sm:text-sm"
      >
        Empezar gratis <span aria-hidden="true">→</span>
      </button>
    )
  }
  return (
    <a
      href="/registro"
      className="relative hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1 text-xs font-bold text-emerald-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 after:absolute after:inset-0 after:-m-2 after:content-[''] sm:inline-flex sm:text-sm"
    >
      Empezar gratis <span aria-hidden="true">→</span>
    </a>
  )
}
