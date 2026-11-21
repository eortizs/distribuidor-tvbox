import { cn } from "cn"

export function BrandInline() {
  return (
    <span className="font-sans">
      <span className="font-bold">SPEIL</span>
      <span className="-ml-[0.13em] font-light">ink</span>
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans tracking-tight", className)}>
      <BrandInline />
    </span>
  )
}
