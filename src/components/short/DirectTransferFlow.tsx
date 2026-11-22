import {
  ArrowRightIcon,
  BellRingIcon,
  LandmarkIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { BrandInline } from "@/components/short/brand"

const NODE_CLASS =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-100 sm:text-sm"

export function DirectTransferFlow() {
  return (
    <div className="mb-6 rounded-2xl border border-white/15 bg-white/5 p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-bold tracking-wide text-emerald-300 uppercase">
            Ruta del dinero · Directa
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className={NODE_CLASS}>
              <LandmarkIcon className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
              Banco del cliente
            </span>
            <ArrowRightIcon className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className={NODE_CLASS}>Transferencia SPEI</span>
            <ArrowRightIcon className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className={NODE_CLASS}>
              <ShieldCheckIcon className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
              Tu cuenta
            </span>
          </div>
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
            100% directo • <BrandInline /> nunca toca ni retiene tu dinero.
          </p>
        </div>

        <div className="flex flex-col gap-4 border-t border-white/10 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <p className="inline-flex items-center gap-2 text-xs font-bold tracking-wide text-slate-200 uppercase">
            <BellRingIcon className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Ruta de <BrandInline /> · Solo lectura
          </p>
          <div className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3">
            <p className="text-sm leading-relaxed text-slate-300">
              Facilitador tecnológico: solo recibimos la notificación del depósito
              para confirmar tu venta por WhatsApp, sin permisos para mover fondos.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
