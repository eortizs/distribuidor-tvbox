"use client"

import { useMemo, useState } from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

/** Normaliza para comparar: minúsculas y sin acentos (búsqueda de /clientes). */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export interface ClientePlataformaRow {
  id: string
  name: string
  slug: string
  status: "active" | "suspended"
  configured: boolean
  /** Código y nombre del afiliado que trajo el negocio. */
  affiliateCode: string
  affiliateName: string
  createdAtLabel: string
}

/**
 * «Clientes» de la cuenta PLATAFORMA: los clientes del admin son los de los
 * afiliados — los negocios que llegaron con un enlace de invitación. El
 * admin no tiene clientes propios. Búsqueda local (lista acotada) sobre
 * negocio, subdominio y afiliado.
 */
export function ClientesPlataforma({
  rows,
}: {
  rows: ClientePlataformaRow[]
}) {
  const [searchInput, setSearchInput] = useState("")
  const term = foldTerm(searchInput)
  const searching = searchInput.trim().length > 0

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          !term ||
          foldTerm(row.name).includes(term) ||
          foldTerm(row.slug).includes(term) ||
          foldTerm(row.affiliateCode).includes(term) ||
          foldTerm(row.affiliateName).includes(term)
      ),
    [rows, term]
  )

  return (
    <Frame className="flex flex-1 flex-col gap-4">
      <FrameHeader className="flex flex-col gap-1">
        <FrameTitle>Negocios referidos</FrameTitle>
        <FrameDescription>
          Los negocios que llegaron con el enlace de algún afiliado. Los altos
          directos sin afiliado se gestionan en Módulos → Tenants.
        </FrameDescription>
      </FrameHeader>

      <div className="flex items-center gap-2">
        <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
          <InputGroupAddon align="inline-start" className="pl-3.5">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar por negocio, subdominio o afiliado"
            className="h-full text-base"
          />
          {searching ? (
            <InputGroupAddon align="inline-end" className="mr-0 pr-2.5">
              <InputGroupButton
                size="icon-sm"
                className="size-9 rounded-full"
                onClick={() => setSearchInput("")}
                aria-label="Limpiar búsqueda"
              >
                <XIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">Negocio</th>
              <th className="px-3 py-2 font-medium">Afiliado</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Configuración</th>
              <th className="px-3 py-2 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-6 text-center">
                  {searching
                    ? "Ningún negocio coincide con la búsqueda."
                    : "Todavía no hay negocios referidos."}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-muted-foreground text-xs">{row.slug}.spei.link</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.affiliateName}</div>
                    <div className="text-muted-foreground font-mono text-xs">{row.affiliateCode}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "active" ? (
                      <Badge variant="primary-light" size="sm">Activo</Badge>
                    ) : (
                      <Badge variant="warning-light" size="sm">Suspendido</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.configured ? (
                      <Badge variant="primary-light" size="sm">Configurado</Badge>
                    ) : (
                      <Badge variant="secondary" size="sm">En proceso</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.createdAtLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}
