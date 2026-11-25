import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { Wordmark } from "@/components/short/brand"
import {
  hostSlugPrefix,
  platformHost,
  tenantBaseHost,
  tenantHostForSlug,
} from "@/server/tenant/hosts"
import { findTenantBySlug } from "@/server/tenant/context"
import { slugAvailabilityShape } from "@/lib/tenant-slug"

/**
 * Buscador de subdominio del apex (§4.6): el dueño escribe SU subdominio y
 * el servidor lo manda al login de SU panel (la cookie de sesión es
 * host-only: no hay login global). Forma + existencia con mensaje propio.
 * Estilo de la landing (excepción ReUI documentada).
 */
export const instant = false

export const metadata: Metadata = {
  title: "Iniciar sesión — SPEILink",
  robots: { index: false, follow: false },
  icons: { icon: "/spei-link-favicon.ico" },
}

export default async function AccederPage({
  searchParams,
}: {
  searchParams: Promise<{ sub?: string }>
}) {
  await connection()
  const baseHost = tenantBaseHost()
  const prefix = hostSlugPrefix()
  const params = await searchParams
  const raw = (params.sub ?? "").trim().toLowerCase()

  if (raw) {
    const slug = raw
      .replace(new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`), "")
      .replace(/\..*$/, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
    const shape = slugAvailabilityShape(slug)
    if (!shape.available) {
      // Re-render con el mensaje propio (nunca redirect a un host inventado).
      return renderForm(baseHost, prefix, raw, "Ese subdominio no tiene una forma válida.")
    }
    const tenant = await findTenantBySlug(slug).catch(() => null)
    if (!tenant || tenant.kind !== "business") {
      return renderForm(
        baseHost,
        prefix,
        raw,
        "No encontramos un negocio con ese subdominio. Revisa la dirección o crea tu cuenta desde el inicio."
      )
    }
    if (tenant.status !== "active") {
      return renderForm(
        baseHost,
        prefix,
        raw,
        "Este negocio está suspendido. Contacta a soporte."
      )
    }
    redirect(`https://${tenantHostForSlug(slug)}/login`)
  }

  return renderForm(baseHost, prefix, "", null)
}

function renderForm(
  baseHost: string,
  prefix: string,
  value: string,
  error: string | null
) {
  return (
    <div className="flex min-h-svh flex-col bg-white text-[#0F172A]">
      <header className="border-b border-slate-200/80 bg-white/85">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center px-4 sm:px-6">
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
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
          Inicia sesión en tu panel
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Escribe el subdominio de tu negocio: te llevamos a la pantalla de
          acceso de tu panel.
        </p>
        {error && (
          <p
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}
        <form method="GET" className="mt-6 flex flex-col gap-3">
          <label htmlFor="sub" className="text-sm font-semibold text-[#1E293B]">
            Subdominio de tu negocio
          </label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white transition-colors focus-within:border-[#059669] focus-within:ring-2 focus-within:ring-[#059669]/25">
            <input
              id="sub"
              name="sub"
              type="text"
              required
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              placeholder="tunegocio"
              defaultValue={value}
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-base text-[#0F172A] outline-none placeholder:text-slate-400"
            />
            <span
              className="flex shrink-0 items-center border-l border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500"
              aria-hidden="true"
            >
              .{prefix}
              {baseHost}
            </span>
          </div>
          <button
            type="submit"
            className="mt-1 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#059669] px-6 text-base font-semibold text-white shadow-lg shadow-[#059669]/25 transition-colors hover:bg-[#047857] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2"
          >
            Continuar
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-slate-500">
          ¿Aún no tienes cuenta?{" "}
          <Link
            href="/registro"
            className="font-semibold text-[#059669] underline underline-offset-2"
          >
            Crea la de tu negocio
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          ¿Eres afiliado?{" "}
          <a
            href={`https://${platformHost()}/login`}
            className="font-semibold text-[#059669] underline underline-offset-2"
          >
            Entra a tu portal
          </a>
        </p>
      </main>
    </div>
  )
}
