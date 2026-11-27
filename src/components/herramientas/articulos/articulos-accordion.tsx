"use client"

import { memo, useState } from "react"
import { ArchiveIcon, ArchiveRestoreIcon, PackageIcon, PencilIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { umEtiqueta, type Articulo } from "@/lib/articulos"
import { paymentOrderMoney } from "@/lib/links-pago"

/*
 * Lista de artículos en acordeón: la misma composición del hub de Módulos y
 * del listado de Clientes (una fila por registro con tile, título y
 * subtítulo; el detalle y las acciones viven en el contenido expandido).
 * `gestion` es el catálogo de Alta de Artículos; `seleccion` es el catálogo
 * de Nota Digital, donde el botón agrega el artículo a la comanda.
 */

const ARTICULOS_POR_TANDA = 100

const fechaFmt = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? "—" : fechaFmt.format(fecha)
}

function ArticulosAccordionBase({
  articulos,
  modo,
  onEditar,
  onArchivar,
  onRestaurar,
  onAgregar,
  cantidadEnComanda,
}: {
  articulos: Articulo[]
  modo: "gestion" | "seleccion"
  onEditar?: (articulo: Articulo) => void
  onArchivar?: (articulo: Articulo) => void
  onRestaurar?: (articulo: Articulo) => void
  onAgregar?: (articulo: Articulo) => void
  cantidadEnComanda?: (id: string) => number
}) {
  // El catálogo completo puede tener hasta 5000 filas: se pintan por tandas
  // para no reconcilar miles de acordeones de una vez. Al cambiar la lista
  // (filtro, búsqueda o realtime) la tanda vuelve a la primera.
  const [visibleCount, setVisibleCount] = useState(ARTICULOS_POR_TANDA)
  const [listaMostrada, setListaMostrada] = useState(articulos)
  if (listaMostrada !== articulos) {
    setListaMostrada(articulos)
    setVisibleCount(ARTICULOS_POR_TANDA)
  }
  const visibles = articulos.slice(0, visibleCount)

  return (
    <>
      <Accordion multiple={false}>
        {visibles.map((articulo) => {
        const archivado = articulo.status === "archived"
        const enComanda = cantidadEnComanda?.(articulo.id) ?? 0
        return (
          <AccordionItem
            key={articulo.id}
            value={articulo.id}
            className="bg-transparent p-0"
          >
            <AccordionTrigger className="items-center gap-3 px-1.5 py-2.5 hover:no-underline">
              <div
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6"
              >
                <PackageIcon />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-base font-semibold tracking-tight">
                  {articulo.nombre}
                </span>
                <span className="text-muted-foreground line-clamp-2 text-left text-xs">
                  {articulo.sku} · {umEtiqueta(articulo.um)} ·{" "}
                  {paymentOrderMoney(articulo.precioUnitario)}
                </span>
              </div>
              {modo === "gestion" && archivado ? (
                <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                  Archivado
                </Badge>
              ) : null}
              {modo === "seleccion" && enComanda > 0 ? (
                <Badge
                  variant="success-light"
                  className="hidden shrink-0 sm:inline-flex"
                >
                  En la comanda ({enComanda})
                </Badge>
              ) : null}
            </AccordionTrigger>
            <AccordionContent className="py-0 pr-1.5 pl-16.5">
              <div className="flex flex-col gap-3 pb-1">
                <p className="text-sm break-words">
                  {articulo.descripcion || "Sin descripción."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      archivado
                        ? "outline"
                        : articulo.disponible
                          ? "success-light"
                          : "secondary"
                    }
                  >
                    {archivado
                      ? "Archivado"
                      : articulo.disponible
                        ? "Disponible"
                        : "No disponible"}
                  </Badge>
                  {articulo.categoria ? (
                    <Badge variant="outline">{articulo.categoria}</Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  Actualizado el {fechaCorta(articulo.updatedAt)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {modo === "gestion" ? (
                    <>
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={() => onEditar?.(articulo)}
                      >
                        <PencilIcon aria-hidden="true" />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        variant="ghost"
                        onClick={() =>
                          archivado
                            ? onRestaurar?.(articulo)
                            : onArchivar?.(articulo)
                        }
                      >
                        {archivado ? (
                          <ArchiveRestoreIcon aria-hidden="true" />
                        ) : (
                          <ArchiveIcon aria-hidden="true" />
                        )}
                        {archivado ? "Restaurar" : "Archivar"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      onClick={() => onAgregar?.(articulo)}
                    >
                      <PlusIcon aria-hidden="true" />
                      {enComanda > 0
                        ? "Agregar otra unidad"
                        : "Agregar a la comanda"}
                    </Button>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
    {articulos.length > visibleCount ? (
      <div className="flex justify-center pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setVisibleCount((prev) => prev + ARTICULOS_POR_TANDA)}
        >
          Mostrar más ({articulos.length - visibleCount} restantes)
        </Button>
      </div>
    ) : null}
    </>
  )
}

/**
 * Memoizado: las vistas pasan callbacks estables, así que escribir en el
 * buscador o cambiar el carrito no vuelve a reconcilar la lista completa.
 */
export const ArticulosAccordion = memo(ArticulosAccordionBase)
