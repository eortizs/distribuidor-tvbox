import { ArrowRightIcon } from "lucide-react"

/*
 * Preventa: el servicio aún no abre al público. Mantener `LAUNCH_ENABLED = false`
 * para que ningún CTA emita enlaces hacia `/register`, `/login` ni `wa.me`.
 * Al lanzar, activar `LAUNCH_ENABLED = true` y cablear `<a href>` con
 * `${publicSiteUrl()}/register`, `${publicSiteUrl()}/login` y
 * `https://wa.me/<WHATSAPP_AGENT_NUMBER>`.
 */
export const LAUNCH_ENABLED = false

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

export function PrimarySignupCta({
  variant,
  className,
}: {
  variant: "navbar" | "hero" | "section" | "banner"
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={!LAUNCH_ENABLED}
      aria-disabled={!LAUNCH_ENABLED}
      className={[
        BASE_CTA_CLASS,
        VARIANT_CLASSES[variant],
        !LAUNCH_ENABLED ? PRESALE_CLASS : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
    </button>
  )
}

export function NavbarLoginButton() {
  return (
    <button
      type="button"
      disabled={!LAUNCH_ENABLED}
      aria-disabled={!LAUNCH_ENABLED}
      className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-[#1E293B] opacity-65 focus-visible:outline-none sm:px-3.5"
    >
      Iniciar sesión
    </button>
  )
}

export function FooterSupportButton() {
  return (
    <button
      type="button"
      disabled={!LAUNCH_ENABLED}
      aria-disabled={!LAUNCH_ENABLED}
      className="inline-flex min-h-11 cursor-not-allowed items-center text-sm font-medium text-slate-600 underline underline-offset-4 opacity-65 focus-visible:outline-none"
    >
      Soporte por WhatsApp
    </button>
  )
}

export function FloatingSignupCta() {
  return (
    <button
      type="button"
      disabled={!LAUNCH_ENABLED}
      aria-disabled={!LAUNCH_ENABLED}
      className="relative hidden shrink-0 cursor-not-allowed items-center gap-1 whitespace-nowrap rounded-full px-1 text-xs font-bold text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-90 after:absolute after:inset-0 after:-m-2 after:content-[''] sm:inline-flex sm:text-sm"
    >
      Empezar gratis <span aria-hidden="true">→</span>
    </button>
  )
}
