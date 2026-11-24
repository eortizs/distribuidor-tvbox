import Link from "next/link"

import { Wordmark } from "@/components/short/brand"

/**
 * Contenedor común de las páginas legales del apex (§4.1): mismo estilo de
 * la landing (colores explícitos, sin tokens del panel), lectura larga
 * (max-w-3xl) y prerender estático (puras, sin APIs de request). El contenido
 * es el texto DEL DUEÑO verbatim (assets/legaales.md): jamás se reescribe
 * copy legal.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-white text-[#0F172A]">
      <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-2 px-4 sm:px-6">
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
            href="/registro"
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-[#1E293B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] sm:px-3.5"
          >
            Crear cuenta
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 text-sm font-medium text-slate-500">{updated}</p>
        <div className="legal-prose mt-8 flex flex-col gap-6">{children}</div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-6">
        <p className="mx-auto max-w-3xl px-4 text-xs leading-relaxed text-slate-500 sm:px-6">
          SPEILink no es institución financiera; los pagos se realizan entre
          cuentas mediante transferencia y la confirmación la da la cuenta de
          Mercado Pago del comercio.
        </p>
      </footer>
    </div>
  )
}

/** Encabezado de sección del documento legal. */
export function LegalSection({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-bold text-[#0F172A] sm:text-xl">{title}</h2>
  )
}

/** Párrafo corrido del documento legal. */
export function LegalParagraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-pretty text-slate-600 sm:text-[15px]">
      {children}
    </p>
  )
}

/** Lista de puntos (los «•» del documento del dueño). */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-5">
      {items.map((item, index) => (
        <li
          key={index}
          className="list-disc text-sm leading-relaxed text-pretty text-slate-600 marker:text-slate-400 sm:text-[15px]"
        >
          {item}
        </li>
      ))}
    </ul>
  )
}

/** Lista numerada (las finalidades, por ejemplo). */
export function LegalOrderedList({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2 pl-5">
      {items.map((item, index) => (
        <li
          key={index}
          className="list-decimal text-sm leading-relaxed text-pretty text-slate-600 marker:text-slate-400 sm:text-[15px]"
        >
          {item}
        </li>
      ))}
    </ol>
  )
}

/** Subtítulo interior (A/B, numerales 1.1…). */
export function LegalSubsection({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-bold text-[#1E293B] sm:text-base">{title}</h3>
  )
}

/** Nota destacada («Importante: …»). */
export function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm leading-relaxed text-pretty text-[#1E293B] sm:text-[15px]">
      {children}
    </p>
  )
}

/** Enlace de correo dentro del documento legal. */
export function LegalEmail({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="font-semibold text-[#059669] underline underline-offset-2"
    >
      {email}
    </a>
  )
}
