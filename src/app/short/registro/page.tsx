import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { LockIcon } from "lucide-react"

import { Wordmark } from "@/components/short/brand"
import { SignupForm } from "@/components/short/signup-form"
import { googleSignupReady } from "@/server/auth/google"
import {
  resolveSignupAffiliate,
  selfSignupEnabled,
} from "@/server/onboarding/signup"
import { hostSlugPrefix, tenantBaseHost } from "@/server/tenant/hosts"
import { AFFILIATE_COOKIE, normalizeAffiliateCode } from "@/lib/afiliados"
import { connection } from "next/server"

/**
 * Registro público de negocios (§4.1 del plan). Vive bajo el apex con el
 * estilo de la landing; el proxy reescribe /registro → /short/registro sin
 * gate de sesión. `connection()` lee el interruptor en CADA petición (sin
 * eso el «abierto/cerrado» se hornearía con el valor del build) y con
 * `instant = false` la página jamás se prerenderiza.
 *
 * Afiliados (§6.6): el código viene de `?af=` (gana) o de la cookie de
 * atribución del enlace; se REVALIDA contra BD (exista + activo) en cada
 * petición. Con invitación válida el formulario se muestra aunque
 * `SELF_SIGNUP_ENABLED` siga apagado; con código inválido se muestra el
 * MISMO estado cerrado de siempre (sin oráculo).
 */
export const instant = false

export const metadata: Metadata = {
  title: "Crear cuenta — SPEILink",
  robots: { index: false, follow: false },
  icons: { icon: "/spei-link-favicon.ico" },
}

/** Mensajes de los errores que vuelven por query desde el flujo Google. */
const SIGNUP_ERRORS: Record<string, string> = {
  signup_closed: "El registro aún no está abierto. Vuelve pronto.",
  signup_rate:
    "Demasiados intentos desde tu conexión. Inténtalo de nuevo en una hora.",
  signup_rejected: "No fue posible crear la cuenta.",
  signup_legal: "Debes aceptar los Términos de Uso y el Aviso de Privacidad.",
  signup_name: "El nombre del negocio debe tener entre 1 y 80 caracteres.",
  signup_slug_reserved: "Ese subdominio está reservado. Elige otro.",
  signup_slug_taken: "Ese subdominio ya está ocupado. Elige otro.",
  signup_slug_shape:
    "El subdominio debe tener 3-30 caracteres (letras, dígitos y guiones), sin guiones al inicio o al final.",
  google_signup_unavailable:
    "El acceso con Google no está disponible en este momento. Usa la opción de correo.",
  google_signup_state:
    "La sesión con Google expiró; inténtalo de nuevo.",
  google_signup_cancelled: "Cancelaste el registro con Google.",
  google_signup_invalid: "No se pudo completar el registro con Google.",
  google_signup_failed: "No se pudo completar el registro con Google.",
  google_signup_email_taken:
    "Ese correo de Google ya está registrado. Inicia sesión desde el panel de tu negocio o usa otro correo.",
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; businessName?: string; slug?: string; af?: string }>
}) {
  await connection()
  const baseHost = tenantBaseHost()
  const prefix = hostSlugPrefix()
  const params = await searchParams
  const oauthError = params.error ? SIGNUP_ERRORS[params.error] ?? null : null

  // Afiliado de la visita: query (?af=) gana sobre cookie de atribución; el
  // código se revalida contra BD en CADA petición (suspendido = cerrado).
  const cookieStore = await cookies()
  const cookieCode = normalizeAffiliateCode(
    cookieStore.get(AFFILIATE_COOKIE)?.value
  )
  const affiliate = await resolveSignupAffiliate(params.af ?? cookieCode)
  const enabled = selfSignupEnabled() || affiliate !== null

  return (
    <div className="flex min-h-svh flex-col bg-white text-[#0F172A]">
      <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]"
            aria-label="SPEILink, inicio"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spei-link-logo.svg"
              alt=""
              aria-hidden="true"
              className="h-7 w-auto sm:h-8"
            />
            <Wordmark className="text-base text-[#0F172A] sm:text-lg" />
          </Link>
          <Link
            href="/acceder"
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-[#1E293B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] sm:px-3.5"
          >
            Iniciar sesión
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-stretch">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
          <div className="order-2 flex flex-col gap-5 lg:order-1">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-[#065F46] sm:text-sm">
              <LockIcon className="size-4 text-[#059669]" aria-hidden="true" />
              Tu panel, tu subdominio.
            </span>
            <h1 className="text-3xl leading-[1.1] font-extrabold tracking-[-0.02em] text-balance text-[#0F172A] sm:text-4xl">
              Crea la cuenta de tu negocio
            </h1>
            <p className="max-w-md text-base leading-relaxed text-pretty text-slate-600 sm:text-lg">
              Al terminar entras directo a tu panel con tu propia dirección{" "}
              <span className="font-semibold text-[#0F172A]">
                tunegocio.{baseHost}
              </span>
              . Ahí conectas tu cuenta de Mercado Pago, eliges la cuenta donde
              recibes y vinculas el WhatsApp de tu negocio.
            </p>
            <ul className="flex flex-col gap-2.5 text-sm text-slate-600">
              {[
                "0% de comisión en cada transferencia que te hacen",
                "Confirmación automática de cada pago por WhatsApp",
                "Tu dinero entra directo a tu cuenta, sin intermediarios",
              ].map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-[#059669]"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="order-1 lg:order-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-7">
              {enabled ? (
                <SignupForm
                  baseHost={baseHost}
                  slugPrefix={prefix}
                  googleReady={googleSignupReady()}
                  oauthError={oauthError}
                  initialBusinessName={params.businessName ?? ""}
                  initialSlug={params.slug ?? ""}
                  affiliateCode={affiliate?.code ?? null}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-[#065F46]">
                    Muy pronto
                  </span>
                  <h2 className="text-xl font-bold text-[#0F172A]">
                    Estamos abriendo el registro
                  </h2>
                  <p className="max-w-sm text-sm leading-relaxed text-slate-600">
                    El alta de negocios aún no está abierta al público. Vuelve
                    a intentarlo en unos días.
                  </p>
                  <Link
                    href="/"
                    className="mt-2 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]"
                  >
                    Volver al inicio
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-6">
        <p className="mx-auto max-w-6xl px-4 text-xs leading-relaxed text-slate-500 sm:px-6 lg:px-8">
          SPEILink no es institución financiera; los pagos se realizan entre
          cuentas mediante transferencia y la confirmación la da la cuenta de
          Mercado Pago del comercio.
        </p>
      </footer>
    </div>
  )
}
