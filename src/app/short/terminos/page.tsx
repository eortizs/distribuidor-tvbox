import type { Metadata } from "next"
import Link from "next/link"

import { Wordmark } from "@/components/short/brand"

/**
 * Términos de Uso del registro (§4.1). TEXTO PENDIENTE DEL DUEÑO (§12):
 * mientras el texto definitivo no se entregue, el registro permanece apagado
 * (SELF_SIGNUP_ENABLED=off) y esta página muestra el marco con el aviso de
 * que el documento está en preparación.
 */
export const metadata: Metadata = {
  title: "Términos de Uso — SPEILink",
  icons: { icon: "/spei-link-favicon.ico" },
}

export default function TermsPage() {
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
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
          Términos de Uso
        </h1>
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-[#92400E]">
          Este documento está en preparación. El registro de negocios permanece
          cerrado hasta que el texto definitivo sea publicado.
        </p>
      </main>
    </div>
  )
}
