"use client"

import { memo, useState } from "react"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BoxesIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { cn } from "cn"
import { Badge } from "@/components/reui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { umEtiqueta } from "@/lib/articulos"
import {
  condicionEtiqueta,
  diasParaVencer,
  estadoCaducidad,
  formatearCantidad,
  formatearFecha,
  hoyIsoCdmx,
  type KindMovimiento,
  type LoteInventario,
} from "@/lib/inventario"

/*
 * Lista de inventario agrupada POR ARTÍCULO: la misma composición en
 * acordeón del hub de Módulos, del catálogo de Alta de Artículos y de
 * Clientes (una fila por artículo con tile, título y subtítulo; los lotes y
 * sus acciones viven en el contenido expandido). Mobile-first: renglones
 * apilados que no parten el contenido a 360 px, botones de texto a 36 px
 * (size="lg") y los de solo icono con zona táctil de 44 px vía
 * `after:-inset-2`.
 */

const GRUPOS_POR_TANDA = 50

/** Referencia mínima del artículo para prellenar «Nuevo lote». */
export interface ArticuloRef {
  id: string
  nombre: string
  sku: string
  um: string
}

export interface GrupoInventario {
  articuloId: string
  sku: string
  nombre: string
  um: string
  lotes: LoteInventario[]
  unidades: number
}

/** Agrupa los lotes por artículo conservando el orden del servidor. */
export function agruparLotes(lotes: LoteInventario[]): GrupoInventario[] {
  const mapa = new Map<string, GrupoInventario>()
  for (const lote of lotes) {
    const existente = mapa.get(lote.articuloId)
    if (existente) {
      existente.lotes.push(lote)
      existente.unidades += lote.cantidad
    } else {
      mapa.set(lote.articuloId, {
        articuloId: lote.articuloId,
        sku: lote.sku,
        nombre: lote.nombre,
        um: lote.um,
        lotes: [lote],
        unidades: lote.cantidad,
      })
    }
  }
  return [...mapa.values()]
}

interface AvisoCaducidad {
  texto: string
  variante: "destructive-light" | "warning-light" | "outline" | null
}

/** Etiqueta y badge de caducidad de un lote respecto a HOY en CDMX. */
function avisoCaducidad(lote: LoteInventario, hoy: string): AvisoCaducidad {
  if (!lote.caducidad) {
    return { texto: "Sin caducidad", variante: null }
  }
  const estado = estadoCaducidad(lote.caducidad, hoy)
  const dias = diasParaVencer(lote.caducidad, hoy)
  if (estado === "vencido") {
    return { texto: `Venció el ${formatearFecha(lote.caducidad)}`, variante: "destructive-light" }
  }
  const vence = dias === 0 ? "Vence HOY" : `Vence el ${formatearFecha(lote.caducidad)}`
  return estado === "por_vencer"
    ? { texto: vence, variante: "warning-light" }
    : { texto: vence, variante: null }
}

function condicionBadge(condicion: string) {
  return condicion === "danado"
    ? { label: condicionEtiqueta(condicion), variante: "destructive-light" as const }
    : condicion === "usado"
      ? { label: condicionEtiqueta(condicion), variante: "outline" as const }
      : { label: condicionEtiqueta(condicion), variante: "info-light" as const }
}

function InventarioAccordionBase({
  grupos,
  onMovimiento,
  onEditar,
  onKardexLote,
  onKardexArticulo,
  onNuevoLote,
}: {
  grupos: GrupoInventario[]
  onMovimiento: (lote: LoteInventario, kind: KindMovimiento) => void
  onEditar: (lote: LoteInventario) => void
  onKardexLote: (lote: LoteInventario) => void
  onKardexArticulo: (grupo: GrupoInventario) => void
  onNuevoLote: (articulo: ArticuloRef) => void
}) {
  const hoy = hoyIsoCdmx()

  // Grupos por tandas: el inventario completo puede tener miles de filas.
  const [visibleCount, setVisibleCount] = useState(GRUPOS_POR_TANDA)
  const [listaMostrada, setListaMostrada] = useState(grupos)
  if (listaMostrada !== grupos) {
    setListaMostrada(grupos)
    setVisibleCount(GRUPOS_POR_TANDA)
  }
  const visibles = grupos.slice(0, visibleCount)

  const mostrarMas =
    grupos.length > visibleCount ? (
      <div className="flex justify-center pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setVisibleCount((prev) => prev + GRUPOS_POR_TANDA)}
        >
          Mostrar más ({grupos.length - visibleCount} restantes)
        </Button>
      </div>
    ) : null

  return (
    <>
      <Accordion multiple={false}>
        {visibles.map((grupo) => {
          const vencidos = grupo.lotes.filter(
            (lote) => lote.caducidad && estadoCaducidad(lote.caducidad, hoy) === "vencido"
          ).length
          const porVencer = grupo.lotes.filter(
            (lote) => lote.caducidad && estadoCaducidad(lote.caducidad, hoy) === "por_vencer"
          ).length
          return (
            <AccordionItem
              key={grupo.articuloId}
              value={grupo.articuloId}
              className="bg-transparent p-0"
            >
              <AccordionTrigger className="items-center gap-3 px-1.5 py-2.5 hover:no-underline">
                <div
                  aria-hidden="true"
                  className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6"
                >
                  <BoxesIcon />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base font-semibold tracking-tight">
                    {grupo.nombre}
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-left text-xs">
                    {grupo.sku} · {umEtiqueta(grupo.um)} ·{" "}
                    {grupo.lotes.length === 1
                      ? "1 lote"
                      : `${grupo.lotes.length} lotes`}{" "}
                    · {formatearCantidad(grupo.unidades)} en stock
                  </span>
                </div>
                {vencidos > 0 ? (
                  <Badge
                    variant="destructive-light"
                    size="sm"
                    className="shrink-0 rounded-full tabular-nums"
                  >
                    {vencidos === 1 ? "1 vencido" : `${vencidos} vencidos`}
                  </Badge>
                ) : porVencer > 0 ? (
                  <Badge
                    variant="warning-light"
                    size="sm"
                    className="shrink-0 rounded-full tabular-nums"
                  >
                    {porVencer === 1 ? "1 por vencer" : `${porVencer} por vencer`}
                  </Badge>
                ) : null}
              </AccordionTrigger>
              <AccordionContent className="py-0 pr-1.5 pl-1.5 sm:pl-16.5">
                <div className="flex flex-col gap-3 pb-1">
                  <ul className="flex flex-col divide-y">
                    {grupo.lotes.map((lote) => {
                      const caducidad = avisoCaducidad(lote, hoy)
                      const condicion = condicionBadge(lote.condicion)
                      const agotado = lote.cantidad <= 0
                      return (
                        <li
                          key={lote.id}
                          className="flex flex-col gap-2 py-3 first:pt-1 last:pb-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant={condicion.variante}>
                                  {condicion.label}
                                </Badge>
                                {agotado ? (
                                  <Badge variant="secondary">Agotado</Badge>
                                ) : null}
                                {lote.lote ? (
                                  <Badge
                                    variant="outline"
                                    className="max-w-full truncate"
                                  >
                                    Lote {lote.lote}
                                  </Badge>
                                ) : null}
                              </div>
                              <span
                                className={cn(
                                  "text-xs",
                                  caducidad.variante === "destructive-light"
                                    ? "text-destructive"
                                    : "text-muted-foreground"
                                )}
                              >
                                {caducidad.texto}
                              </span>
                              {lote.ubicacion ? (
                                <span className="text-muted-foreground text-xs">
                                  Ubicación: {lote.ubicacion}
                                </span>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right">
                              <span
                                className={cn(
                                  "text-base font-semibold tabular-nums",
                                  agotado && "text-muted-foreground"
                                )}
                              >
                                {formatearCantidad(lote.cantidad)}
                              </span>
                              <span className="block text-muted-foreground text-xs">
                                {umEtiqueta(grupo.um)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="lg"
                              variant="outline"
                              onClick={() => onMovimiento(lote, "entrada")}
                            >
                              <ArrowDownToLineIcon aria-hidden="true" />
                              Entrada
                            </Button>
                            <Button
                              type="button"
                              size="lg"
                              variant="outline"
                              onClick={() => onMovimiento(lote, "salida")}
                            >
                              <ArrowUpFromLineIcon aria-hidden="true" />
                              Salida
                            </Button>
                            <Button
                              type="button"
                              size="lg"
                              variant="ghost"
                              onClick={() => onMovimiento(lote, "ajuste")}
                            >
                              <SlidersHorizontalIcon aria-hidden="true" />
                              Ajustar
                            </Button>
                            <Button
                              type="button"
                              size="icon-lg"
                              variant="ghost"
                              aria-label={`Ver kardex del lote de ${grupo.nombre}`}
                              className="relative after:absolute after:content-[''] after:-inset-2"
                              onClick={() => onKardexLote(lote)}
                            >
                              <HistoryIcon aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-lg"
                              variant="ghost"
                              aria-label={`Editar los datos del lote de ${grupo.nombre}`}
                              className="relative after:absolute after:content-[''] after:-inset-2"
                              onClick={() => onEditar(lote)}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="lg"
                      variant="ghost"
                      onClick={() =>
                        onNuevoLote({
                          id: grupo.articuloId,
                          nombre: grupo.nombre,
                          sku: grupo.sku,
                          um: grupo.um,
                        })
                      }
                    >
                      <PlusIcon aria-hidden="true" />
                      Nuevo lote de este artículo
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      variant="ghost"
                      onClick={() => onKardexArticulo(grupo)}
                    >
                      <HistoryIcon aria-hidden="true" />
                      Kardex del artículo
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      {mostrarMas}
    </>
  )
}

/**
 * Memoizado: las vistas pasan callbacks estables, así que escribir en el
 * buscador no vuelve a reconciliar la lista completa.
 */
export const InventarioAccordion = memo(InventarioAccordionBase)
