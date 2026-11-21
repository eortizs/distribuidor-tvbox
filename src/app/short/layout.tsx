import type { ReactNode } from "react"
import { Plus_Jakarta_Sans } from "next/font/google"

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
})

export default function ShortLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${plusJakartaSans.variable} [font-family:var(--font-plus-jakarta),var(--font-geist-sans),sans-serif]`}
    >
      {children}
    </div>
  )
}
