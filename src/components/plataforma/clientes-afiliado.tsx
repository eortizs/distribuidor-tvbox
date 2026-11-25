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

export interface ClienteAfiliadoRow {
  id: string
  name: string
  slug: string
  status: "active" | "suspended"
  configured: boolean
  /** Correo del propietario del negocio; null si el alta quedó a medias. */
  ownerEmail: string | null
  createdAtLabel: string
}

/**
 * «Clientes» del perfil AFILIADO: los propietarios de los negocios que
 * llegaron con SU enlace. Búsqueda local sobre negocio, subdominio y
 * propietario.
 */
export function ClientesAfiliado({
  rows,
}: {
  rows: ClienteAfiliadoRow[]
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
          foldTerm(row.ownerEmail ?? "").includes(term)
      ),
    [rows, term]
  )

  return (
    <Frame className="flex flex-1 flex-col gap-4">
      <FrameHeader className="flex flex-col gap-1">
        <FrameTitle>Mis negocios</FrameTitle>
        <FrameDescription>
          Los negocios que llegaron con tu enlace y sus propietarios.
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
            aria-label="Buscar por negocio, subdominio o propietario"
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
              <th className="px-3 py-2 font-medium">Propietario</th>
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
                    : "Todavía no hay negocios con tu enlace. Compártelo desde Inicio."}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-muted-foreground text-xs">{row.slug}.spei.link</div>
                  </td>
                  <td className="px-3 py-2">{row.ownerEmail ?? "—"}</td>
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
