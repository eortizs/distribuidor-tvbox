"use client"

/**
 * Pantalla Herramientas (`/modulos`): listado de herramientas compuesto
 * con el mismo acordeón de la pantalla Clientes (`c-accordion-9` de ReUI,
 * una fila por herramienta, una sola abierta a la vez):
 *
 * - Fila: icono de la herramienta en tile (`size-12`, `bg-muted`); como
 *   título, el nombre y, como subtítulo, la breve descripción. La fila
 *   completa es un enlace real a la herramienta: al pulsarla se ejecuta.
 * - Al margen derecho, la estrella de favoritos y el botón settings-2 de
 *   lucide: este último es el trigger del acordeón y, al pulsarlo,
 *   despliega las opciones de la herramienta.
 * - Contenido expandido: dos botones en lista — «Configurar» (fantasma, con
 *   icono de controles) navega a la herramienta en modo configuración
 *   (`href` + `?editar=1`) cuando el módulo lo declara `configurable` en el
 *   catálogo; el resto siguen siendo maquetas sin funcionalidad por ahora.
 *   «Eliminar» (variante destructive, separada del resto) es maqueta.
 *
 * **Buscador** (`/clientes` como referencia): píldora con lupa encima de
 * los filtros; filtra por nombre y descripción (sin acentos) y suma una X
 * de limpieza visible solo con texto.
 * **Filtros** (`/clientes` como referencia): barra de vistas sobre el
 * listado — «Todos», «Favoritos», los filtros creados por el usuario y el
 * botón «Crear filtro» (círculo «+»). Cada vista lleva su contador en un
 * Badge; la activa se pinta con el foreground del tema; volver a pulsar la
 * vista activa no la suelta (radio fijo).
 *
 * - **Favorito**: estrella junto al nombre de cada módulo; la estrella
 *   llena indica favorito. Es hermana del enlace (un botón dentro de un
 *   `<a>` rompería el HTML): vive entre el enlace y el trigger.
 * - **Crear filtro**: diálogo con nombre; los filtros nuevos aparecen como
 *   vistas adicionales a «Todos» y «Favoritos».
 * - **Clic sostenido (~0.5 s) sobre el módulo**: diálogo para asignarlo a
 *   los filtros disponibles (selección múltiple). Si no hay filtros
 *   creados, no hace nada. El pulso largo cancela el click del enlace
 *   (guardia en la fase de captura) y cancela el gesto si hay arrastre.
 *
 * **Persistencia**: favoritos, filtros y asignaciones viven en el servidor
 * (`user_module_prefs`, por usuario): web y mobile comparten el mismo
 * estado. Los cambios se guardan con debounce (~400 ms) vía server action y
 * se difunden por el bus de tiempo real (evento `prefs`): editar favoritos
 * en un dispositivo se refleja en los demás al instante. La primera visita
 * tras el cambio migra lo que hubiera en localStorage
 * (`modulos.filtros.v1`) al servidor y limpia la clave.
 */

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  MODULOS,
  modulePrefsEqual,
  normalizeModulePrefs,
  type Asignaciones,
  type Modulo,
  type ModuloFiltro,
  type ModulePrefs,
} from "@/lib/modulos"
import { saveModulePrefsAction } from "@/app/actions/modulos"
import { Badge } from "@/components/reui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { cn } from "cn"

type Herramienta = Modulo

/** Duración del clic sostenido que abre la asignación a filtros (ms). */
const LONG_PRESS_MS = 500

/** Arrastre máximo (px) que se tolera sin cancelar el clic sostenido. */
const LONG_PRESS_SLACK_PX = 10

/** Debounce del guardado de preferencias en el servidor (ms). */
const SAVE_DEBOUNCE_MS = 400

/**
 * Clave de localStorage donde vivían favoritos, filtros y asignaciones
 * antes de pasar al servidor; la migración la lee una sola vez y la borra.
 */
const FILTROS_STORAGE_KEY = "modulos.filtros.v1"

/** Vista activa: fondo del color de primer plano del tema, texto opuesto. */
const VISTA_ACTIVE_CLASS =
  "aria-pressed:bg-foreground aria-pressed:text-background hover:aria-pressed:bg-foreground"

/** Contador dentro de una vista: se invierte sobre el fondo activo. */
const VISTA_COUNT_CLASS =
  "rounded-full tabular-nums group-aria-pressed/toggle:border-background/40 group-aria-pressed/toggle:bg-transparent dark:group-aria-pressed/toggle:border-background/40 dark:group-aria-pressed/toggle:bg-transparent"

/**
 * Normaliza para comparar textos: minúsculas y sin acentos, igual que la
 * búsqueda de `/clientes` («calculo» encuentra «Calculadora»).
 */
function foldTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function HerramientasAccordion({
  initialPrefs,
  isAdmin = false,
}: {
  /** Preferencias ya guardadas en el servidor; null si el usuario aún no tiene. */
  initialPrefs: ModulePrefs | null
  /**
   * La cuenta es admin: ve además los módulos `adminOnly` (Distribuidores).
   * Para el resto de cuentas esos módulos no existen en el catálogo.
   */
  isAdmin?: boolean
}) {
  const [favorites, setFavorites] = useState<string[]>(
    initialPrefs?.favorites ?? []
  )
  const [categories, setCategories] = useState<ModuloFiltro[]>(
    initialPrefs?.categories ?? []
  )
  const [assignments, setAssignments] = useState<Asignaciones>(
    initialPrefs?.assignments ?? {}
  )
  const [view, setView] = useState<string>("todos")
  const [searchInput, setSearchInput] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [assignTarget, setAssignTarget] = useState<{
    tool: Herramienta
    picked: Set<string>
  } | null>(null)

  /**
   * Snapshot confirmado por el servidor: la referencia para distinguir «el
   * refresco trae lo que yo mismo guardé» (no-op) de «otro dispositivo
   * cambió algo» (adoptar). El dirty flag marca cambios locales pendientes
   * de guardar; mientras existan, un evento remoto no pisa la edición local.
   */
  const serverSnapshotRef = useRef<ModulePrefs | null>(initialPrefs)
  const dirtyRef = useRef(false)
  const migrationRef = useRef(false)

  // Adopción remota: un evento `prefs` de otro dispositivo refresca la RSC
  // y llega por aquí. Solo aplica sin ediciones locales pendientes. El
  // setState corre en un microtask: nada se pinta intermedio y el efecto
  // queda como suscripción al cambio de props.
  useEffect(() => {
    if (!initialPrefs) return
    void Promise.resolve().then(() => {
      if (dirtyRef.current) return
      if (modulePrefsEqual(initialPrefs, serverSnapshotRef.current)) return
      serverSnapshotRef.current = initialPrefs
      setFavorites(initialPrefs.favorites)
      setCategories(initialPrefs.categories)
      setAssignments(initialPrefs.assignments)
    })
  }, [initialPrefs])

  // Migración única: sin estado en el servidor, sube lo que hubiera en
  // localStorage; con estado confirmado, la clave vieja queda obsoleta.
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (initialPrefs) {
        try {
          window.localStorage.removeItem(FILTROS_STORAGE_KEY)
        } catch {
          // Almacenamiento bloqueado: el dato viejo simplemente no se usa.
        }
        return
      }
      let stored: unknown = null
      try {
        stored = JSON.parse(
          window.localStorage.getItem(FILTROS_STORAGE_KEY) ?? "null"
        ) as unknown
      } catch {
        // Almacenamiento ilegible: se parte con las preferencias vacías.
      }
      const revived = normalizeModulePrefs(stored)
      if (modulePrefsEqual(revived, normalizeModulePrefs(null))) return
      setFavorites(revived.favorites)
      setCategories(revived.categories)
      setAssignments(revived.assignments)
      migrationRef.current = true
      dirtyRef.current = true
    })
  }, [initialPrefs])

  // Guardado con debounce: cada cambio local programa la subida; el último
  // gana. Dirty se limpia al disparar el timer (el snapshot es el más
  // nuevo); una edición posterior lo vuelve a marcar y reprograma. Al
  // confirmarse, el snapshot del servidor se actualiza para que el eco del
  // evento propio (router.refresh) no dispare una adopción.
  useEffect(() => {
    if (!dirtyRef.current) return
    const snapshot: ModulePrefs = { favorites, categories, assignments }
    const timer = window.setTimeout(() => {
      dirtyRef.current = false
      void saveModulePrefsAction(snapshot).then((result) => {
        if (!result.ok) {
          // Falló la subida: pendiente de resolver; el próximo cambio reintenta.
          dirtyRef.current = true
          return
        }
        serverSnapshotRef.current = result.prefs
        if (migrationRef.current) {
          migrationRef.current = false
          try {
            window.localStorage.removeItem(FILTROS_STORAGE_KEY)
          } catch {
            // Sin localStorage no hay migración que limpiar.
          }
        }
      })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [favorites, categories, assignments])

  const toggleFavorite = (href: string) => {
    dirtyRef.current = true
    setFavorites((prev) =>
      prev.includes(href)
        ? prev.filter((value) => value !== href)
        : [...prev, href]
    )
  }

  const createFilter = (name: string) => {
    const clean = name.trim().slice(0, 40)
    if (clean === "") return "Escribe un nombre para el filtro."
    const duplicate = categories.some(
      (category) => category.name.toLowerCase() === clean.toLowerCase()
    )
    if (duplicate) return "Ya existe un filtro con ese nombre."
    const category = { id: crypto.randomUUID(), name: clean }
    dirtyRef.current = true
    setCategories((prev) => [...prev, category])
    return null
  }

  const saveAssignments = (tool: Herramienta, picked: Set<string>) => {
    dirtyRef.current = true
    setAssignments((prev) => {
      const next = { ...prev }
      if (picked.size === 0) {
        delete next[tool.href]
      } else {
        next[tool.href] = [...picked]
      }
      return next
    })
    toast.success(
      picked.size === 0
        ? `«${tool.title}» no pertenece a ningún filtro`
        : `«${tool.title}» asignada a ${picked.size} ${
            picked.size === 1 ? "filtro" : "filtros"
          }`
    )
  }

  /**
   * Catálogo visible para esta cuenta: el listado completo de MODULOS menos
   * los módulos `adminOnly` cuando la cuenta no es admin. La búsqueda, las
   * vistas y los contadores trabajan siempre sobre este catálogo.
   */
  const catalog = useMemo(
    () => MODULOS.filter((tool) => !tool.adminOnly || isAdmin),
    [isAdmin]
  )

  const visible = useMemo(() => {
    const term = foldTerm(searchInput)
    return catalog.filter((tool) => {
      if (view === "todos") {
        // Sin vista: solo la búsqueda acota.
      } else if (view === "favoritos") {
        if (!favorites.includes(tool.href)) return false
      } else if (!(assignments[tool.href] ?? []).includes(view)) {
        return false
      }
      if (!term) return true
      return (
        foldTerm(tool.title).includes(term) ||
        foldTerm(tool.description).includes(term)
      )
    })
  }, [catalog, view, favorites, assignments, searchInput])

  const searching = searchInput.trim().length > 0

  /** Clic sostenido sobre un módulo: abre la asignación si hay filtros. */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const longPressFired = useRef(false)

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressStart.current = null
  }

  const startPress = (tool: Herramienta, x: number, y: number) => {
    clearPress()
    pressStart.current = { x, y }
    longPressFired.current = false
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      // Sin filtros creados el gesto no hace nada, según lo acordado.
      if (categories.length === 0) return
      longPressFired.current = true
      navigator.vibrate?.(30)
      setAssignTarget({
        tool,
        picked: new Set(assignments[tool.href] ?? []),
      })
    }, LONG_PRESS_MS)
  }

  const categoryCount = (id: string) =>
    catalog.filter((tool) =>
      (assignments[tool.href] ?? []).includes(id)
    ).length

  return (
    <div className="flex flex-col gap-4">
      {/*
       * Buscador (misma composición que /clientes): renglón flex con la
       * píldora redondeada — lupa y botón de limpieza (X) visible solo con
       * texto. El renglón es el mismo contenedor de /clientes (búsqueda +
       * botón), aquí sin el botón de sincronizar, para que flex-1 y h-12
       * resuelvan las mismas dimensiones exactas. Filtra por nombre y
       * descripción del módulo encima de cualquier vista activa.
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
       * Barra de vistas (misma composición que /clientes): renglón único
       * desplazable en horizontal con el scrollbar oculto; el «+» de crear
       * queda al final de las vistas.
       */}
      <div
        role="toolbar"
        aria-label="Filtros de módulos"
        className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
      >
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[view]}
          onValueChange={(groupValue) => {
            // Radio fijo: volver a pulsar la vista activa no la suelta.
            const next = groupValue[0] ?? view
            if (next !== view) setView(next)
          }}
          aria-label="Vistas de módulos"
        >
          <ToggleGroupItem value="todos" className={`rounded-full ${VISTA_ACTIVE_CLASS}`}>
            Todos
            <Badge variant="outline" size="xs" className={VISTA_COUNT_CLASS}>
              {catalog.length}
            </Badge>
          </ToggleGroupItem>
          <ToggleGroupItem value="favoritos" className={`rounded-full ${VISTA_ACTIVE_CLASS}`}>
            Favoritos
            <Badge variant="outline" size="xs" className={VISTA_COUNT_CLASS}>
              {favorites.length}
            </Badge>
          </ToggleGroupItem>
          {categories.map((category) => (
            <ToggleGroupItem
              key={category.id}
              value={category.id}
              className={`rounded-full ${VISTA_ACTIVE_CLASS}`}
            >
              {category.name}
              <Badge variant="outline" size="xs" className={VISTA_COUNT_CLASS}>
                {categoryCount(category.id)}
              </Badge>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Crear filtro"
          onClick={() => setCreateOpen(true)}
          className="size-7 rounded-full bg-foreground p-0 text-background hover:bg-foreground/80 [&_svg:not([class*='size-'])]:size-4"
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          {searching
            ? "Ningún módulo coincide con la búsqueda."
            : view === "favoritos"
              ? "Marca la estrella de un módulo para verlo aquí."
              : "Ningún módulo pertenece a este filtro. Mantén pulsado un módulo para asignarlo."}
        </p>
      ) : (
        <Accordion multiple={false}>
          {visible.map((tool) => {
            const isFavorite = favorites.includes(tool.href)
            return (
              <AccordionItem
                key={tool.href}
                value={tool.href}
                className="bg-transparent p-0"
              >
                <div className="flex items-center">
                  <Link
                    href={tool.href}
                    className="flex min-w-0 flex-1 select-none items-center gap-3 rounded-lg px-1.5 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [touch-callout:none] [user-select:none] dark:hover:bg-muted/50"
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) {
                        return
                      }
                      startPress(tool, event.clientX, event.clientY)
                    }}
                    onPointerMove={(event) => {
                      const start = pressStart.current
                      if (!pressTimer.current || !start) return
                      if (
                        Math.hypot(event.clientX - start.x, event.clientY - start.y) >
                        LONG_PRESS_SLACK_PX
                      ) {
                        clearPress()
                      }
                    }}
                    onPointerUp={clearPress}
                    onPointerLeave={clearPress}
                    onPointerCancel={clearPress}
                    onContextMenu={(event) => event.preventDefault()}
                    onClickCapture={(event) => {
                      // El pulso largo ya abrió el diálogo: el click que
                      // sigue no debe navegar ni expandir el acordeón.
                      if (longPressFired.current) {
                        event.preventDefault()
                        event.stopPropagation()
                        longPressFired.current = false
                      }
                    }}
                  >
                    <div
                      aria-hidden="true"
                      className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6"
                    >
                      <tool.icon />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                      <span className="truncate text-base font-semibold tracking-tight">
                        {tool.title}
                      </span>
                      <span className="text-muted-foreground line-clamp-2 text-left text-xs">
                        {tool.description}
                      </span>
                    </div>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleFavorite(tool.href)}
                    aria-label={
                      isFavorite
                        ? `Quitar ${tool.title} de favoritos`
                        : `Marcar ${tool.title} como favorito`
                    }
                    aria-pressed={isFavorite}
                    className={cn(
                      "mr-1 size-8 shrink-0 rounded-full",
                      isFavorite
                        ? "text-foreground [&_svg]:fill-current"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <StarIcon aria-hidden="true" />
                  </Button>
                  <AccordionTrigger
                    aria-label={`Opciones de ${tool.title}`}
                    className="mr-1.5 size-11 shrink-0 flex-none items-center justify-center rounded-full border-transparent p-0 text-muted-foreground hover:bg-muted hover:no-underline focus-visible:border-transparent dark:hover:bg-muted/50 aria-expanded:bg-muted dark:aria-expanded:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden"
                  >
                    <Settings2Icon aria-hidden="true" className="size-5" />
                  </AccordionTrigger>
                </div>
                <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
                  <div className="flex flex-col items-stretch gap-1 pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="w-full max-w-56 justify-start"
                      {...(tool.configurable
                        ? {
                            render: <Link href={`${tool.href}?editar=1`} />,
                            nativeButton: false,
                          }
                        : {})}
                    >
                      <SlidersHorizontalIcon aria-hidden="true" />
                      Configurar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="lg"
                      className="w-full max-w-56 justify-start"
                    >
                      <TrashIcon aria-hidden="true" />
                      Eliminar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}

      {createOpen ? (
        <CrearFiltroDialog
          onCreate={createFilter}
          onDone={() => setCreateOpen(false)}
        />
      ) : null}
      {assignTarget ? (
        <AsignarFiltrosDialog
          target={assignTarget}
          categories={categories}
          onSave={(picked) => {
            saveAssignments(assignTarget.tool, picked)
            setAssignTarget(null)
          }}
          onDone={() => setAssignTarget(null)}
        />
      ) : null}
    </div>
  )
}

/** Diálogo «Crear filtro»: alta de una categoría nueva para módulos. */
function CrearFiltroDialog({
  onCreate,
  onDone,
}: {
  onCreate: (name: string) => string | null
  onDone: () => void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const failure = onCreate(name)
    if (failure) {
      setError(failure)
      return
    }
    toast.success(`Filtro «${name.trim().slice(0, 40)}» creado`)
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear filtro</DialogTitle>
          <DialogDescription>
            Agrupa módulos bajo un nombre propio; aparecerá como vista junto a
            «Todos» y «Favoritos».
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <Field>
            <FieldLabel htmlFor="nuevo-filtro-nombre">Nombre</FieldLabel>
            <Input
              id="nuevo-filtro-nombre"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              placeholder="Ej. Ventas"
              maxLength={40}
              autoFocus
              required
            />
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit">Crear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Diálogo de asignación por clic sostenido: checkboxes con los filtros
 * disponibles (los creados por el usuario; «Todos» y «Favoritos» no entran,
 * la estrella ya cubre favoritos).
 */
function AsignarFiltrosDialog({
  target,
  categories,
  onSave,
  onDone,
}: {
  target: { tool: Herramienta; picked: Set<string> }
  categories: ModuloFiltro[]
  onSave: (picked: Set<string>) => void
  onDone: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(target.picked)

  const toggle = (id: string, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar a filtros</DialogTitle>
          <DialogDescription>
            Elige en qué filtros aparece «{target.tool.title}». La estrella de
            favoritos se maneja desde la fila.
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-col gap-1"
          role="group"
          aria-label="Filtros disponibles"
        >
          {categories.map((category) => {
            const id = `asignar-${category.id}`
            return (
              <div key={category.id} className="flex items-center gap-3 py-1.5">
                <Checkbox
                  id={id}
                  checked={picked.has(category.id)}
                  onCheckedChange={(checked) => toggle(category.id, checked === true)}
                />
                <FieldLabel
                  htmlFor={id}
                  className="text-foreground text-sm font-medium"
                >
                  {category.name}
                </FieldLabel>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button type="button" onClick={() => onSave(picked)}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
