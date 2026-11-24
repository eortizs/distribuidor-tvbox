"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import {
  signupBusinessAction,
  startGoogleSignupAction,
  type SignupBusinessState,
} from "@/app/actions/onboarding-signup"
import { slugify, slugAvailabilityShape } from "@/lib/tenant-slug"

/**
 * Formulario del registro público (§4.1). Dos vías: «Continuar con Google»
 * (flujo del dueño: botón `formAction` con la acción de arranque OAuth; el
 * callback del apex crea el negocio y entrega la sesión por ticket) y
 * correo + contraseña (la misma de siempre, respaldo si Google no está
 * configurado). El slug se sugiere desde el nombre del negocio y se valida
 * en vivo contra GET /api/onboarding/slug (route handler: las acciones de
 * servidor se despachan en serie y encolarían el sondeo). La disponibilidad
 * visible se DERIVA del render (regla del repo: sin setState en effects);
 * el effect solo trae el veredicto del servidor.
 */

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-[#0F172A] transition-colors outline-none placeholder:text-slate-400 focus-visible:border-[#059669] focus-visible:ring-2 focus-visible:ring-[#059669]/25 aria-invalid:border-red-400"
const LABEL_CLASS = "text-sm font-semibold text-[#1E293B]"
const FIELD_ERROR_CLASS = "text-xs font-medium text-red-600"

type SlugVerdict =
  | { kind: "available" }
  | { kind: "unavailable"; reason: "forma" | "reservado" | "ocupado" }

export function SignupForm({
  baseHost,
  slugPrefix,
  googleReady,
  oauthError,
  initialBusinessName = "",
  initialSlug = "",
}: {
  baseHost: string
  slugPrefix: string
  /** Cliente Google SPEILink listo y URI fija en ESTE apex. */
  googleReady: boolean
  /** Error devuelto por el flujo Google (query del callback). */
  oauthError: string | null
  initialBusinessName?: string
  initialSlug?: string
}) {
  const [state, formAction, pending] = useActionState<SignupBusinessState, FormData>(
    signupBusinessAction,
    { error: null }
  )
  const [businessName, setBusinessName] = useState(initialBusinessName)
  const [slug, setSlug] = useState(initialSlug)
  const [slugTouched, setSlugTouched] = useState(initialSlug.length > 0)
  const [verdict, setVerdict] = useState<{ slug: string; result: SlugVerdict } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const checkSeq = useRef(0)

  // Sugerencia de slug mientras el usuario no lo toque a mano (derivado).
  const effectiveSlug = slugTouched ? slug : slugify(businessName)
  const shape = effectiveSlug ? slugAvailabilityShape(effectiveSlug) : null

  // Disponibilidad visible (derivado): la forma manda al instante; el
  // veredicto del servidor se muestra cuando corresponde al slug actual.
  const slugStatus:
    | { status: "idle" }
    | { status: "checking" }
    | { status: "available" }
    | { status: "unavailable"; reason: "forma" | "reservado" | "ocupado" } =
    !effectiveSlug
      ? { status: "idle" }
      : shape && !shape.available
        ? { status: "unavailable", reason: shape.reason }
        : verdict?.slug === effectiveSlug
          ? verdict.result.kind === "available"
            ? { status: "available" }
            : { status: "unavailable", reason: verdict.result.reason }
          : { status: "checking" }
  const slugUnavailable = slugStatus.status === "unavailable"

  // Sondeo del servidor (debounce 400 ms + guardia de secuencia). El único
  // setState vive dentro del callback del fetch, nunca en el cuerpo.
  useEffect(() => {
    const current = slugTouched ? slug : slugify(businessName)
    const local = current ? slugAvailabilityShape(current) : null
    if (!current || !local || !local.available) return
    const seq = ++checkSeq.current
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/onboarding/slug?slug=${encodeURIComponent(current)}`,
            { cache: "no-store" }
          )
          if (!response.ok) throw new Error(String(response.status))
          const data = (await response.json()) as {
            available: boolean
            reason?: "forma" | "reservado" | "ocupado"
          }
          if (checkSeq.current !== seq) return
          setVerdict(
            data.available
              ? { slug: current, result: { kind: "available" } }
              : {
                  slug: current,
                  result: {
                    kind: "unavailable",
                    reason: data.reason ?? "ocupado",
                  },
                }
          )
        } catch {
          // Endpoint caído: se mantiene «verificando»; el envío revalida.
        }
      })()
    }, 400)
    return () => clearTimeout(timer)
  }, [slug, slugTouched, businessName])

  // Fallback (§4.1): la acción no llegó por la reescritura del apex — se
  // reintenta por POST /api/onboarding/signup (directa, el matcher del proxy
  // excluye /api) y el redirect lo hace el navegador con la URL recibida.
  useEffect(() => {
    if (!state.fallback || !formRef.current) return
    let cancelled = false
    const fd = new FormData(formRef.current)
    void (async () => {
      try {
        const response = await fetch("/api/onboarding/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessName: String(fd.get("businessName") ?? ""),
            slug: String(fd.get("slug") ?? ""),
            fullName: String(fd.get("fullName") ?? ""),
            email: String(fd.get("email") ?? ""),
            password: String(fd.get("password") ?? ""),
            legal: fd.get("legal") === "on",
            website: String(fd.get("website") ?? ""),
          }),
        })
        const data = (await response.json()) as {
          redirectUrl?: string
          error?: string
        }
        if (cancelled) return
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl
          return
        }
        setFallbackError(data.error ?? "No fue posible crear la cuenta.")
      } catch {
        if (!cancelled) {
          setFallbackError("No se pudo completar el registro. Inténtalo de nuevo.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.fallback])

  const busy = pending || (state.fallback === true && fallbackError === null)
  const slugOk = slugStatus.status === "available"
  const previewHost = effectiveSlug
    ? `${slugPrefix}${effectiveSlug}.${baseHost}`
    : null

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      {/* Honeypot: campo invisible para humanos; los bots lo rellenan. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {(state.error !== null || fallbackError !== null || oauthError !== null) && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
          role="alert"
        >
          {oauthError ?? state.error ?? fallbackError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="businessName" className={LABEL_CLASS}>
          Nombre de tu negocio
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          maxLength={80}
          autoComplete="organization"
          placeholder="Abarrotes Doña Lupe"
          className={INPUT_CLASS}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="slug" className={LABEL_CLASS}>
          Tu dirección en SPEILink
        </label>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white transition-colors focus-within:border-[#059669] focus-within:ring-2 focus-within:ring-[#059669]/25">
          <input
            id="slug"
            name="slug"
            type="text"
            required
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            placeholder="abarrotes-lupe"
            className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-base text-[#0F172A] outline-none placeholder:text-slate-400"
            value={effectiveSlug}
            aria-invalid={slugUnavailable || undefined}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, "-")
                  .replace(/-{2,}/g, "-")
              )
            }}
          />
          <span
            className="flex shrink-0 items-center border-l border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500"
            aria-hidden="true"
          >
            .{baseHost}
          </span>
        </div>
        <div className="min-h-12 text-xs" aria-live="polite">
          {slugStatus.status === "checking" && (
            <span className="block font-medium text-slate-500">
              Verificando disponibilidad…
            </span>
          )}
          {slugOk && previewHost && (
            <span className="block font-medium text-emerald-700">
              Disponible: https://{previewHost}
            </span>
          )}
          {slugUnavailable && (
            <span className={FIELD_ERROR_CLASS}>
              {slugStatus.reason === "reservado"
                ? "Ese subdominio está reservado."
                : slugStatus.reason === "ocupado"
                  ? "Ese subdominio ya está ocupado."
                  : "Usa 3-30 caracteres: letras, dígitos y guiones."}
            </span>
          )}
          {effectiveSlug.length > 0 && (
            <span className="block text-slate-500">
              No se puede cambiar después.
            </span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
        <input
          id="legal"
          name="legal"
          type="checkbox"
          required
          className="mt-0.5 size-4 shrink-0 accent-[#059669]"
        />
        <label htmlFor="legal" className="text-xs leading-relaxed text-slate-600">
          Acepto los{" "}
          <a
            href="/terminos"
            className="font-semibold text-[#059669] underline underline-offset-2"
          >
            Términos de Uso
          </a>{" "}
          y el{" "}
          <a
            href="/privacidad"
            className="font-semibold text-[#059669] underline underline-offset-2"
          >
            Aviso de Privacidad
          </a>
          .
        </label>
      </div>

      {googleReady && (
        <>
          <button
            type="submit"
            formAction={startGoogleSignupAction}
            disabled={busy || slugUnavailable}
            className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-6 text-base font-semibold text-[#1E293B] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            Continuar con Google
          </button>
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-slate-400">
              o crea con tu correo
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className={LABEL_CLASS}>
          Tu nombre completo
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          maxLength={100}
          autoComplete="name"
          placeholder="Lupe Ramírez"
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={LABEL_CLASS}>
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="lupe@ejemplo.mx"
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={LABEL_CLASS}>
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            className={`${INPUT_CLASS} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-14 items-center justify-center rounded-r-xl text-xs font-semibold text-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]/40"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? "Ocultar" : "Ver"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy || slugUnavailable}
        className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#059669] px-6 text-base font-semibold text-white shadow-lg shadow-[#059669]/25 transition-colors hover:bg-[#047857] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Creando tu cuenta…" : "Crear mi cuenta gratis"}
      </button>
      <p className="text-center text-xs text-slate-500">
        Al crear tu cuenta llegas directo a tu panel: te guiamos para conectar
        Mercado Pago y tu WhatsApp.
      </p>
    </form>
  )
}
