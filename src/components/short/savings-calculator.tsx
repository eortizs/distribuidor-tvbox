"use client"

import { Slider } from "@base-ui/react/slider"
import { CheckIcon } from "lucide-react"
import { useState } from "react"

import { BrandInline } from "@/components/short/brand"
import {
  SAVINGS_DEFAULT_SALES_MXN,
  SAVINGS_MAX_SALES_MXN,
  SAVINGS_MIN_SALES_MXN,
  SAVINGS_PRESETS_MXN,
  SAVINGS_STEP_MXN,
  calculateSpeiLinkSavings,
  formatMxnWhole,
} from "@/lib/spei-link-savings"

export function SavingsCalculator() {
  const [monthlySales, setMonthlySales] = useState<number>(SAVINGS_DEFAULT_SALES_MXN)
  const savings = calculateSpeiLinkSavings(monthlySales)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/[0.04] sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <p id="savings-slider-label" className="text-sm font-semibold text-[#1E293B]">
          ¿Cuánto vendes al mes con tarjeta o transferencia?
        </p>
        <p className="text-2xl font-extrabold tracking-[-0.02em] text-[#0F172A] tabular-nums sm:text-3xl">
          {formatMxnWhole(savings.monthlySalesMxn)}{" "}
          <span className="text-sm font-semibold text-slate-500">MXN / mes</span>
        </p>
      </div>

      <div className="mt-5">
        <Slider.Root
          value={monthlySales}
          onValueChange={(nextValue) => setMonthlySales(nextValue)}
          min={SAVINGS_MIN_SALES_MXN}
          max={SAVINGS_MAX_SALES_MXN}
          step={SAVINGS_STEP_MXN}
          largeStep={10_000}
          thumbAlignment="edge"
          className="w-full"
        >
          <Slider.Control className="relative flex w-full cursor-pointer touch-none items-center py-3 select-none">
            <Slider.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-slate-200">
              <Slider.Indicator className="h-full rounded-full bg-[#059669]" />
            </Slider.Track>
            <Slider.Thumb
              getAriaLabel={() => "Ventas mensuales estimadas en pesos mexicanos"}
              getAriaValueText={(_formatted, val) => `${formatMxnWhole(val)} pesos al mes`}
              className="relative block size-6 shrink-0 cursor-pointer rounded-full border-2 border-[#059669] bg-white shadow-md shadow-[#059669]/25 transition-shadow after:content-[''] after:absolute after:-inset-2.5 hover:ring-4 hover:ring-[#059669]/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#059669]/30 motion-reduce:transition-none"
            />
          </Slider.Control>
        </Slider.Root>
        <div className="flex items-center justify-between text-xs font-medium text-slate-500 tabular-nums">
          <span>$5,000</span>
          <span>$200,000</span>
        </div>
      </div>

      <div
        role="group"
        aria-label="Montos mensuales rápidos"
        className="mt-4 flex flex-wrap gap-2"
      >
        {SAVINGS_PRESETS_MXN.map((preset) => {
          const active = monthlySales === preset
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => setMonthlySales(preset)}
              className={[
                "inline-flex min-h-11 items-center justify-center rounded-xl border px-3.5 text-sm font-semibold tabular-nums transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-2",
                active
                  ? "border-[#059669] bg-emerald-50 text-[#065F46]"
                  : "border-slate-200 bg-[#F8FAFC] text-[#1E293B] hover:border-slate-300 hover:bg-slate-100",
              ].join(" ")}
            >
              {formatMxnWhole(preset)}
            </button>
          )
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" aria-live="polite">
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-5">
          <span className="inline-flex rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200/80">
            Terminales tradicionales (4%)
          </span>
          <div className="mt-3">
            <p className="text-sm text-slate-600">Regalas en comisiones al mes</p>
            <p className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums sm:text-3xl">
              -{formatMxnWhole(savings.traditionalMonthlyFeeMxn)} MXN
            </p>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-rose-200/60 pt-3">
            <span className="text-sm text-slate-600">Pérdida acumulada al año</span>
            <span className="text-base font-bold text-rose-800 tabular-nums">
              -{formatMxnWhole(savings.traditionalAnnualFeeMxn)} MXN
            </span>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-[#059669]/40 bg-emerald-50/70 p-5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#059669] px-2.5 py-0.5 text-xs font-semibold text-white">
            <CheckIcon className="size-3.5" aria-hidden="true" />
            <span>Con <BrandInline /> (0%)</span>
          </span>
          <div className="mt-3">
            <p className="text-sm text-[#1E293B]">Te ahorras al año para tu negocio</p>
            <p className="mt-1 text-2xl font-extrabold text-[#059669] tabular-nums sm:text-3xl">
              +{formatMxnWhole(savings.annualSavingsMxn)} MXN
            </p>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-emerald-200 pt-3">
            <span className="text-sm text-[#1E293B]">Comisión por cobro SPEI</span>
            <span className="text-base font-bold text-[#065F46] tabular-nums">
              $0 MXN (ahorras {formatMxnWhole(savings.monthlySavingsMxn)}/mes)
            </span>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Cálculo ilustrativo basado en una comisión promedio de 4% (3.5% + IVA) de terminales bancarias y agregadores en México.
      </p>
    </div>
  )
}
