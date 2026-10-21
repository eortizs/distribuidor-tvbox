"use server"

import { requireUser } from "@/server/auth/guards"
import {
  QUALITY_STEPS,
  findImageModel,
  supportsQuality,
  supportsSize,
  type ImageRenderQuality,
  type QualityStepId,
} from "@/server/images/models"
import {
  saveImageLevels,
  type ImageLevelConfig,
  type ImageLevelConfigs,
} from "@/server/images/settings"

export interface SaveImageModelsState {
  error: string | null
  success: string | null
}

/**
 * Valida el nivel: modelo conocido, calidad que el modelo admita y tamaño
 * que el modelo admita (los que no apliquen, en null).
 */
function levelConfig(
  formData: FormData,
  id: QualityStepId
): ImageLevelConfig | null {
  const model = String(formData.get(`${id}Model`) ?? "").trim()
  const quality = String(formData.get(`${id}Quality`) ?? "").trim()
  const size = String(formData.get(`${id}Size`) ?? "").trim()

  const info = findImageModel(model)
  if (!info) return null
  if (quality && !supportsQuality(info, quality)) return null
  if (size && !supportsSize(info, size)) return null

  return {
    model,
    quality:
      quality && supportsQuality(info, quality)
        ? (quality as ImageRenderQuality)
        : null,
    size: size && supportsSize(info, size) ? size : null,
  }
}

export async function saveImageModelsAction(
  _prev: SaveImageModelsState,
  formData: FormData
): Promise<SaveImageModelsState> {
  const user = await requireUser()

  const configs = {} as ImageLevelConfigs
  for (const step of QUALITY_STEPS) {
    const config = levelConfig(formData, step.id)
    if (!config) {
      return {
        error: `Revisa el modelo, la calidad y el tamaño de "${step.label}".`,
        success: null,
      }
    }
    configs[step.id] = config
  }

  await saveImageLevels(user.id, configs)
  return { error: null, success: "Modelos actualizados" }
}
