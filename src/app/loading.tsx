import { Spinner } from "@/components/ui/spinner"

export default function Loading() {
  return (
    <div
      data-app-loading
      className="bg-background flex min-h-svh w-full flex-col items-center justify-center gap-2"
    >
      <Spinner className="size-5 opacity-60" />
      <span className="text-muted-foreground text-sm">Cargando…</span>
    </div>
  )
}
