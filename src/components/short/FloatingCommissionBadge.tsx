"use client"

import { useEffect, useState } from "react"

import { FloatingSignupCta } from "@/components/short/landing-cta"

const SHOW_AFTER_SCROLL_PX = 450

export function FloatingCommissionBadge() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let frame = 0

    const update = () => {
      frame = 0
      const footer = document.getElementById("landing-footer")
      const footerReached = footer
        ? footer.getBoundingClientRect().top <= window.innerHeight
        : false
      setVisible(window.scrollY > SHOW_AFTER_SCROLL_PX && !footerReached)
    }

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update)
    }

    schedule()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-slate-700/80 bg-slate-900/95 px-4 py-2.5 text-white shadow-xl backdrop-blur-md">
      <span aria-hidden="true" className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
      </span>
      <span className="min-w-0 truncate text-[11px] font-medium sm:text-sm">
        Confirmación automática en todas tus transferencias, siempre
      </span>
      <FloatingSignupCta />
    </div>
  )
}
