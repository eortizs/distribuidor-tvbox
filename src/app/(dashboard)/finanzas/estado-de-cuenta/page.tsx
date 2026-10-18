import type { Metadata } from "next"

import { EstadoCuentaView } from "@/components/finanzas/estado-cuenta-view"

export const metadata: Metadata = {
  title: "Estado de cuenta",
}

export default function EstadoDeCuentaPage() {
  return <EstadoCuentaView />
}
