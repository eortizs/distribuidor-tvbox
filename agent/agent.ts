import { gateway } from "@ai-sdk/gateway";
import { defineAgent } from "eve";

const MODEL_ID = process.env.ANIMATION_MODEL ?? "xiaomi/mimo-v2.6-pro";

// El AI Gateway recorta la salida a 4096 tokens en modelos que no figuran en
// su registro; con reasoning alto el modelo agota ese presupuesto solo en
// razonar y eve recibe pasos vacíos ("empty model response" → turno
// estacionado). Se fija explícito en cada llamada (configurable con
// ANIMATION_MAX_OUTPUT_TOKENS; el catálogo del gateway declara 524288 para
// minimax).
const MAX_OUTPUT_TOKENS =
  Number(process.env.ANIMATION_MAX_OUTPUT_TOKENS) || 65_536;

const base = gateway(MODEL_ID);

type GatewayCallOptions = Parameters<typeof base.doGenerate>[0];

const model = {
  specificationVersion: base.specificationVersion,
  provider: base.provider,
  modelId: base.modelId,
  supportedUrls: base.supportedUrls,
  doGenerate: async (options: GatewayCallOptions) =>
    base.doGenerate({
      ...options,
      maxOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    }),
  doStream: async (options: GatewayCallOptions) =>
    base.doStream({
      ...options,
      maxOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    }),
};

export default defineAgent({
  defaultTools: false,
  model,
  // Ventana de contexto del modelo (el catálogo del gateway declara 1M para
  // minimax-m3.1-flash); eve la exige con modelos-objeto para planear la
  // compactación. Ajustar junto con ANIMATION_MODEL si cambia.
  modelContextWindowTokens:
    Number(process.env.ANIMATION_CONTEXT_WINDOW_TOKENS) || 1_000_000,
  // Razonamiento al máximo: eve solo acepta hasta "xhigh" (el AI SDK lo
  // reenvía tal cual al AI Gateway, que lo mapea al nivel máximo nativo del
  // proveedor — p. ej. reasoning "max" en minimax).
  reasoning: "xhigh",
});
