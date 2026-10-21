"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  saveImageModelsAction,
  type SaveImageModelsState,
} from "@/app/actions/configuracion"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  QUALITY_STEPS,
  defaultSizeFor,
  findImageModel,
  sizeOptionsFor,
  type ImageModelInfo,
  type QualityStepId,
} from "@/server/images/models"
import type { ImageLevelConfigs } from "@/server/images/settings"

const initialState: SaveImageModelsState = { error: null, success: null }

type LevelDraft = {
  model: string
  quality: string
  size: string
}

type ConfiguracionViewProps = {
  /** Modelos verificables del gateway que se pueden asignar. */
  models: readonly ImageModelInfo[]
  /** Configuración guardada de cada nivel. */
  levels: ImageLevelConfigs
}

export function ConfiguracionView({ models, levels }: ConfiguracionViewProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    saveImageModelsAction,
    initialState
  )
  const [draft, setDraft] = useState<Record<QualityStepId, LevelDraft>>(() => ({
    media: {
      model: levels.media.model,
      quality: levels.media.quality ?? "",
      size: levels.media.size ?? "",
    },
    alta: {
      model: levels.alta.model,
      quality: levels.alta.quality ?? "",
      size: levels.alta.size ?? "",
    },
  }))

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state.success, router])

  /**
   * Cambia un campo del nivel. Al cambiar de modelo, la calidad y el tamaño
   * se reajustan a los que ese modelo admite.
   */
  function update(id: QualityStepId, patch: Partial<LevelDraft>) {
    setDraft((current) => {
      const next = { ...current[id], ...patch }
      const info = findImageModel(next.model)
      if (info) {
        if (next.quality && !info.qualities.includes(next.quality as never)) {
          next.quality = info.qualities[info.qualities.length - 1] ?? ""
        }
        if (next.size && !info.sizes.includes(next.size)) {
          next.size = defaultSizeFor(info) ?? ""
        }
      }
      return { ...current, [id]: next }
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Modelos de imagen</CardTitle>
        <CardDescription className="text-sm">
          Define el modelo, la calidad y el tamaño de cada nivel del control
          de calidad de la herramienta Imágenes. La calidad determina el costo
          por imagen: la máxima es la más cara.
        </CardDescription>
      </CardHeader>
      <form action={formAction} className="flex flex-col">
        <CardContent className="flex flex-col gap-6">
          {QUALITY_STEPS.map((step) => {
            const level = draft[step.id]
            const info = findImageModel(level.model)
            const sizes = info ? sizeOptionsFor(info) : []
            const qualities = info?.qualities ?? []
            return (
              <div key={step.id} className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Calidad {step.label.toLowerCase()}
                </h3>
                <Field>
                  <FieldLabel htmlFor={`${step.id}-model`}>Modelo</FieldLabel>
                  <Select
                    name={`${step.id}Model`}
                    value={level.model}
                    onValueChange={(value) =>
                      update(step.id, { model: value as string })
                    }
                  >
                    <SelectTrigger id={`${step.id}-model`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {qualities.length > 0 ? (
                  <Field>
                    <FieldLabel htmlFor={`${step.id}-quality`}>
                      Calidad
                    </FieldLabel>
                    <Select
                      name={`${step.id}Quality`}
                      value={level.quality}
                      onValueChange={(value) =>
                        update(step.id, { quality: value as string })
                      }
                    >
                      <SelectTrigger id={`${step.id}-quality`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {qualities.map((quality) => (
                          <SelectItem key={quality} value={quality}>
                            {quality === "auto" ? "Automática" : quality}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      La calidad determina el costo de cada imagen.
                    </FieldDescription>
                  </Field>
                ) : (
                  <input type="hidden" name={`${step.id}Quality`} value="" />
                )}
                {sizes.length > 0 ? (
                  <Field>
                    <FieldLabel htmlFor={`${step.id}-size`}>Tamaño</FieldLabel>
                    <Select
                      name={`${step.id}Size`}
                      value={level.size}
                      onValueChange={(value) =>
                        update(step.id, { size: value as string })
                      }
                    >
                      <SelectTrigger id={`${step.id}-size`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes.map((size) => (
                          <SelectItem key={size.value} value={size.value}>
                            {size.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : (
                  <input type="hidden" name={`${step.id}Size`} value="" />
                )}
              </div>
            )
          })}
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="pt-3">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar modelos"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
