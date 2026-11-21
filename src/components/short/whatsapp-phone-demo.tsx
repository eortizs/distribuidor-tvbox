import type { ReactNode } from "react"
import { CircleCheckIcon } from "lucide-react"

import { BrandInline } from "@/components/short/brand"

function ChatBubble({
  side,
  variant = "client",
  time,
  children,
}: {
  side: "left" | "right"
  variant?: "client" | "assistant" | "verified"
  time: string
  children: ReactNode
}) {
  const bubbleClass =
    variant === "client"
      ? "max-w-[86%] rounded-2xl rounded-br-sm bg-[#DCF8C6] px-3 py-2 text-[13px] leading-snug text-[#111B21] shadow-xs"
      : variant === "assistant"
        ? "max-w-[88%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[13px] leading-snug text-[#111B21] shadow-xs"
        : "max-w-[90%] rounded-2xl rounded-bl-sm border border-[#059669]/40 bg-emerald-50/95 px-3 py-2 text-[13px] leading-snug text-[#0F172A] shadow-xs"

  return (
    <div className={`flex w-full ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div className={bubbleClass}>
        {children}
        <span className="mt-1 block text-right text-[10px] leading-none text-black/45 tabular-nums">
          {time} ✓✓
        </span>
      </div>
    </div>
  )
}

export function WhatsAppPhoneDemo() {
  return (
    <div className="relative mx-auto w-full max-w-[360px] lg:max-w-[380px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-4 rounded-[3rem] bg-gradient-to-tr from-emerald-500/15 via-sky-500/10 to-transparent blur-2xl"
      />
      <div className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-[#0F172A] bg-[#0F172A] shadow-2xl shadow-slate-900/20">
        <div
          aria-hidden="true"
          className="flex items-center justify-between bg-[#0F172A] px-5 pt-2.5 pb-1.5 text-[11px] font-semibold text-white/80"
        >
          <span className="tabular-nums">10:36</span>
          <span className="h-3.5 w-20 rounded-full bg-black/70" />
          <span>5G • 100%</span>
        </div>

        <div className="flex items-center gap-3 border-b border-white/10 bg-[#0F172A] px-4 py-3 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spei-link-logo.svg"
            alt=""
            aria-hidden="true"
            className="size-9 shrink-0 rounded-full bg-white p-1.5"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold leading-tight text-white">
              <BrandInline /> Asistente
            </span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
              Validación en tiempo real
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 bg-[#ECE5DD] px-3 pt-3 pb-7">
          <ChatBubble side="right" time="10:30">
            Solicito un link de pago por{" "}
            <span className="font-semibold tabular-nums">$500.00 MXN</span>
          </ChatBubble>

          <ChatBubble side="left" variant="assistant" time="10:30">
            <p className="mb-1.5">
              Transfiere <span className="font-semibold tabular-nums">$500.00 MXN</span>{" "}
              directo a:
            </p>
            <p className="mb-1 flex items-center gap-1.5">
              <span>CLABE:</span>
              <span className="rounded border border-dashed border-[#059669]/60 bg-emerald-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#0F172A] tabular-nums">
                646180…
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <span>Concepto:</span>
              <span className="rounded border border-dashed border-[#059669]/60 bg-emerald-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#0F172A]">
                COMPRA500
              </span>
            </p>
          </ChatBubble>

          <ChatBubble side="right" time="10:34">
            Listo, ya hice la transferencia
          </ChatBubble>

          <ChatBubble side="left" variant="assistant" time="10:34">
            Envíame la foto del comprobante de tu transferencia para confirmar el pago.
          </ChatBubble>

          <ChatBubble side="right" time="10:35">
            Va, ya la envié 📎
          </ChatBubble>

          <ChatBubble side="left" variant="verified" time="10:36">
            ✅ <span className="font-semibold text-[#065F46]">¡Pago verificado en cuenta!</span>{" "}
            Depósito de <span className="font-semibold tabular-nums">$500.00 MXN</span>{" "}
            confirmado con concepto{" "}
            <span className="font-mono font-semibold text-[#0F172A]">COMPRA500</span>.
          </ChatBubble>
        </div>

        <div aria-hidden="true" className="flex justify-center bg-[#0F172A] py-2">
          <span className="h-1 w-24 rounded-full bg-white/25" />
        </div>
      </div>

      <div className="relative z-10 mx-3 -mt-4 rounded-2xl border border-emerald-200/90 bg-white/90 px-4 py-3 shadow-xl shadow-slate-900/10 backdrop-blur-md sm:mx-4 sm:-mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#059669]"
            >
              <CircleCheckIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0F172A]">
                Depósito SPEI verificado en cuenta
              </p>
              <p className="text-xs text-slate-500">
                Concepto <span className="font-mono font-semibold text-[#1E293B]">COMPRA500</span> · 0% comisión
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-extrabold text-[#059669] tabular-nums">
            +$500.00 MXN
          </span>
        </div>
      </div>
    </div>
  )
}
