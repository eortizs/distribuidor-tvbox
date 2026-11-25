"use client"

/**
 * Hub de módulos de la CONSOLA DE PLATAFORMA (`platform.spei.link/platform`),
 * misma composición que el hub `/modulos` del panel
 * (`herramientas-accordion.tsx`): buscador en píldora, barra de vistas
 * («Todos» / «Favoritos») y acordeón con una fila por módulo — icono en tile,
 * título y descripción; la fila entera es un enlace al módulo y la estrella
 * marca favorito.
 *
 * Diferencias deliberadas con el hub del panel: SIN filtros creados por el
 * usuario ni asignaciones por clic sostenido (dos módulos de administración),
 * y los favoritos viven en LOCALSTORAGE — `user_module_prefs` valida contra
 * el catálogo del panel, que no incluye hrefs del host de plataforma. La
 * persistencia está GATEADA por hidratación (lección de la Calculadora: sin
 * la gate, el flush del montaje pisaba lo guardado antes de que la carga
 * lo leyera).
 */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { SearchIcon, StarIcon, XIcon } from "lucide-react"

import {
  PLATFORM_MODULOS,
  type PlatformModulo,
} from "@/lib/platform-modulos"
import { Badge } from "@/components/reui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { cn } from "cn"

const FAVORITES_STORAGE_KEY = "platform.modulos.favoritos.v1"

/** Vista activa: fondo del color de primer plano del tema, texto opuesto. */
const VISTA_ACTIVE_CLASS =
  "aria-pressed:bg-foreground aria-pressed:text-background hover:aria-pressed:bg-foreground"

/** Contador dentro de una vista: se invierte sobre el fondo activo. */
const VISTA_COUNT_CLASS =
  "rounded-full tabular-nums group-aria-pressed/toggle:border-background/40 group-aria-pressed/toggle:bg-transparent dark:group-aria-pressed/toggle:border-background/40 dark:group-aria-pressed/toggle:bg-transparent"

/** Normaliza para comparar: minúsculas y sin acentos (búsqueda de /clientes). */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Lee los favoritos guardados; historia corrupta o storage bloqueado → []. */
function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
    if (!Array.isArray(parsed)) return []
    const hrefs = new Set(PLATFORM_MODULOS.map((modulo) => modulo.href))
    return [
      ...new Set(
        parsed.filter(
          (value): value is string => typeof value === "string" && hrefs.has(value)
        )
      ),
    ]
  } catch {
    return []
  }
}

export function PlatformModulosHub() {
  const [favorites, setFavorites] = useState<string[]>([])
  const [cintaLista, setCintaLista] = useState(false)
  const [view, setView] = useState<string>("todos")
  const [searchInput, setSearchInput] = useState("")

  // Hidratación: la carga corre en microtarea y el guardado queda gateado
  // por `cintaLista`; el flush de efectos del montaje jamás pisa lo guardado.
  useEffect(() => {
    void Promise.resolve().then(() => {
      setFavorites(readFavorites())
      setCintaLista(true)
    })
  }, [])

  useEffect(() => {
    if (!cintaLista) return
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites))
    } catch {
      // Storage bloqueado: los favoritos viven solo en memoria esta visita.
    }
  }, [cintaLista, favorites])

  const toggleFavorite = (href: string) => {
    setFavorites((prev) =>
      prev.includes(href)
        ? prev.filter((value) => value !== href)
        : [...prev, href]
    )
  }

  const visible = useMemo(() => {
    const term = foldTerm(searchInput)
    return PLATFORM_MODULOS.filter((modulo) => {
      if (view === "favoritos" && !favorites.includes(modulo.href)) return false
      if (!term) return true
      return (
        foldTerm(modulo.title).includes(term) ||
        foldTerm(modulo.description).includes(term)
      )
    })
  }, [favorites, view, searchInput])

  const searching = searchInput.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      {/*
       * Buscador (misma composición que /modulos del panel): píldora con
       * lupa y X de limpieza visible solo con texto.
       */}
      <div className="flex items-center gap-2">
        <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
          <InputGroupAddon align="inline-start" className="pl-3.5">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar módulo por nombre o descripción"
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

      {/*
       * Barra de vistas (misma composición que /modulos del panel): el
       * «+» de crear filtro del panel no existe aquí — los módulos de la
       * consola no se agrupan por filtros propios.
       */}
      <div
        role="toolbar"
        aria-label="Vistas de módulos"
        className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
      >
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[view]}
          onValueChange={(groupValue) => {
            const next = groupValue[0] ?? view
            if (next !== view) setView(next)
          }}
          aria-label="Vistas de módulos"
        >
          <ToggleGroupItem value="todos" className={`rounded-full ${VISTA_ACTIVE_CLASS}`}>
            Todos
            <Badge variant="outline" size="xs" className={VISTA_COUNT_CLASS}>
              {PLATFORM_MODULOS.length}
            </Badge>
          </ToggleGroupItem>
          <ToggleGroupItem value="favoritos" className={`rounded-full ${VISTA_ACTIVE_CLASS}`}>
            Favoritos
            <Badge variant="outline" size="xs" className={VISTA_COUNT_CLASS}>
              {favorites.length}
            </Badge>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          {searching
            ? "Ningún módulo coincide con la búsqueda."
            : view === "favoritos"
              ? "Marca la estrella de un módulo para verlo aquí."
              : "No hay módulos."}
        </p>
      ) : (
        <Accordion multiple={false}>
          {visible.map((modulo: PlatformModulo) => {
            const isFavorite = favorites.includes(modulo.href)
            return (
              <AccordionItem
                key={modulo.href}
                value={modulo.href}
                className="bg-transparent p-0"
              >
                <div className="flex items-center">
                  <Link
                    href={modulo.href}
                    className="flex min-w-0 flex-1 select-none items-center gap-3 rounded-lg px-1.5 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50"
                  >
                    <div
                      aria-hidden="true"
                      className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6"
                    >
                      <modulo.icon />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                      <span className="truncate text-base font-semibold tracking-tight">
                        {modulo.title}
                      </span>
                      <span className="text-muted-foreground line-clamp-2 text-left text-xs">
                        {modulo.description}
                      </span>
                    </div>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleFavorite(modulo.href)}
                    aria-label={
                      isFavorite
                        ? `Quitar ${modulo.title} de favoritos`
                        : `Marcar ${modulo.title} como favorito`
                    }
                    aria-pressed={isFavorite}
                    className={cn(
                      "relative mr-1 size-8 shrink-0 rounded-full after:absolute after:inset-0 after:-m-2 after:content-['']",
                      isFavorite
                        ? "text-foreground [&_svg]:fill-current"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <StarIcon aria-hidden="true" />
                  </Button>
                  <AccordionTrigger
                    aria-label={`Opciones de ${modulo.title}`}
                    className="mr-1.5 size-11 shrink-0 flex-none items-center justify-center rounded-full border-transparent p-0 text-muted-foreground hover:bg-muted hover:no-underline focus-visible:border-transparent dark:hover:bg-muted/50 aria-expanded:bg-muted dark:aria-expanded:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden"
                  >
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Abrir
                    </span>
                  </AccordionTrigger>
                </div>
                <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
                  <div className="flex flex-col items-stretch gap-1 pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="w-full max-w-56 justify-start"
                      render={<Link href={modulo.href} />}
                      nativeButton={false}
                    >
                      Abrir {modulo.title}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
