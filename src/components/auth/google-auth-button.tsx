"use client"

import Link from "next/link"
import { RiGoogleFill } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

/** Entrada de Google OAuth: manda a /api/auth/google/start. */
export function GoogleAuthButton() {
  return (
    <div className="grid gap-4">
      <div className="relative">
        <Separator />
        <span className="text-muted-foreground bg-background absolute inset-0 flex items-center justify-center text-xs">
          o
        </span>
      </div>
      <Button
        variant="outline"
        className="w-full"
        render={<Link href="/api/auth/google/start" prefetch={false} />}
      >
        <RiGoogleFill
          data-icon="inline-start"
          aria-hidden="true"
          className="text-[#DB4437] dark:text-white/60"
          size={16}
        />
        <span className="text-muted-foreground">Continuar con</span> Google
      </Button>
    </div>
  )
}
