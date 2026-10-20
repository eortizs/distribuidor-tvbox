import { gateway } from "@ai-sdk/gateway";
import type { ModelMessage } from "ai";
import { defineAgent, defineDynamic } from "eve";

import {
  animationModelIdFromMessages,
  animationModels,
  eveReasoningLevel,
  findAnimationModel,
} from "../src/server/animaciones/models";

/*
 * Modelo del agente de animación seleccionable por turno desde la UI.
 *
 * El selector viaja como clientContext del turno (`modelo-seleccionado: <id>`);
 * eve lo expone al resolver dinámico como mensaje user-role efímero (no se
 * persiste en el historial durable). La lista de IDs válidos vive en
 * `ANIMATION_MODELS` (.env) y cada entrada del catálogo declara el nivel de
 * razonamiento máximo que reporta el AI Gateway, que se envía explícito en
 * cada llamada.
 */

const MODELS = animationModels();
const DEFAULT_MODEL = MODELS[0];

if (!DEFAULT_MODEL) {
  throw new Error("animacion: no hay modelos disponibles en ANIMATION_MODELS");
}

// El AI Gateway recorta la salida a 4096 tokens en modelos que no figuran en
// su registro; con reasoning alto el modelo agota ese presupuesto solo en
// razonar y eve recibe pasos vacíos ("empty model response" → turno
// estacionado). Se fija explícito en cada llamada (configurable con
// ANIMATION_MAX_OUTPUT_TOKENS), acotado al tope que declara el catálogo de
// cada modelo.
const MAX_OUTPUT_TOKENS =
  Number(process.env.ANIMATION_MAX_OUTPUT_TOKENS) || 65_536;

function modelFor(id: string) {
  const meta = findAnimationModel(id)
  if (!meta) return null
  const base = gateway(meta.id)
  const maxOutputTokens = Math.min(meta.maxOutputTokens, MAX_OUTPUT_TOKENS)
  const reasoning = meta.maxReasoningLevel

  type GatewayCallOptions = Parameters<typeof base.doGenerate>[0];

  // Envoltorio que fija en cada llamada el tope de salida y el nivel máximo de
  // razonamiento reportado por el gateway (incluido "max", que la unión de
  // eve no acepta: el AI SDK lo reenvía tal cual al AI Gateway).
  const model = {
    specificationVersion: base.specificationVersion,
    provider: base.provider,
    modelId: base.modelId,
    supportedUrls: base.supportedUrls,
    doGenerate: async (options: GatewayCallOptions) =>
      base.doGenerate({
        ...options,
        maxOutputTokens: options.maxOutputTokens ?? maxOutputTokens,
        reasoning,
      }),
    doStream: async (options: GatewayCallOptions) =>
      base.doStream({
        ...options,
        maxOutputTokens: options.maxOutputTokens ?? maxOutputTokens,
        reasoning,
      }),
  }

  return { model, meta }
}

function selectedId(messages: readonly ModelMessage[]): string {
  const requested = animationModelIdFromMessages(messages)
  if (requested && findAnimationModel(requested)) return requested
  return DEFAULT_MODEL.id
}

/** Selección serializable (session/turn): id + metadata declarada. */
function durableSelection(id: string) {
  const meta = findAnimationModel(id) ?? DEFAULT_MODEL
  return {
    model: meta.id,
    modelContextWindowTokens: meta.contextWindowTokens,
    reasoning: eveReasoningLevel(meta.maxReasoningLevel),
  }
}

export default defineAgent({
  defaultTools: false,
  model: defineDynamic({
    events: {
      // Valor por defecto antes de que llegue el primer turno.
      "session.started": () => durableSelection(DEFAULT_MODEL.id),
      // El selector del turno (clientContext) llega aquí como mensaje efímero.
      "turn.started": (_event, ctx) =>
        durableSelection(selectedId(ctx.messages)),
      // Antes de cada llamada al modelo: objeto vivo con el razonamiento
      // máximo nativo ("max" incluido) y el tope de salida forzados.
      "step.started": (_event, ctx) => {
        const selection = modelFor(selectedId(ctx.messages))
        if (!selection) return durableSelection(DEFAULT_MODEL.id)
        return {
          model: selection.model,
          modelContextWindowTokens: selection.meta.contextWindowTokens,
          reasoning: eveReasoningLevel(selection.meta.maxReasoningLevel),
        }
      },
    },
  }),
  // Razonamiento explícito por modelo en cada selección dinámica; a nivel de
  // agente queda el máximo que eve acepta como respaldo.
  reasoning: "xhigh",
})
