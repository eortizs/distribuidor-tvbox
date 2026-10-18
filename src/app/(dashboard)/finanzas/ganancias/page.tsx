import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ganancias",
}

export default function GananciasPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Ganancias</h1>
        </div>
      </div>
    </div>
  )
}
