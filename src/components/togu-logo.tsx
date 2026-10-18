import { cn } from "cn"

function ToguLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Togu"
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path
        d="M9 9h14v4h-5v10h-4V13H9z"
        className="fill-primary-foreground"
      />
    </svg>
  )
}

export { ToguLogo }
