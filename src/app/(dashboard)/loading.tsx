import { Spinner } from "@/components/ui/spinner"

export default function Loading() {
  return (
    <div
      data-app-loading
      className="flex w-full flex-1 flex-col items-center justify-center gap-2 px-4 py-16"
    >
      <Spinner className="size-5 opacity-60" />
      <span className="text-muted-foreground text-sm">Cargando…</span>
    </div>
  )
}
