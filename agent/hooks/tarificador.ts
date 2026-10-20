import { defineHook } from "eve/hooks";

import {
  addTurnInputWait,
  closeAnimationTurn,
  getTurnCostUsd,
  meterAnimationStep,
  mirrorAnimationTurnExpense,
  openAnimationTurn,
} from "../../src/server/animaciones/service";

/*
 * Tarificador + contador de tiempo del agente de animación.
 *
 * - Cada `step.completed` registra su costo/tokens (los reintentos re-emiten
 *   el mismo step y el UPSERT los resuelve por última escritura).
 * - Cada `turn.started` abre un turno; el cierre computa la duración de
 *   trabajo descontando las ventanas en que el turno esperó a un humano
 *   (`turn.waiting` con on: "input"). Al cerrar, el costo del turno se
 *   espeja al control de gastos (categoría "Animación").
 *
 * Los hooks son observe-only: cualquier fallo se registra y el turno sigue.
 */

const MAX_TRACKED = 500;

/** Small insertion-ordered map that drops the oldest entry past the cap. */
function track<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

const modelByStep = new Map<string, string>();
const inputWaitStartedAt = new Map<string, number>();

function stepKey(sessionId: string, turnId: string, stepIndex: number): string {
  return `${sessionId}\u0000${turnId}\u0000${stepIndex}`;
}

function turnKey(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`;
}

function userIdOf(ctx: {
  session: {
    auth: {
      current: { principalId: string } | null;
      initiator: { principalId: string } | null;
    };
  };
}): string | null {
  return (
    ctx.session.auth.current?.principalId ??
    ctx.session.auth.initiator?.principalId ??
    null
  );
}

function logError(scope: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `animacion: ${scope}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  );
}

/** Closes an open human-input wait window, accumulating it on the turn. */
async function closeInputWait(
  sessionId: string,
  turnId: string
): Promise<void> {
  const key = turnKey(sessionId, turnId);
  const startedAt = inputWaitStartedAt.get(key);
  if (startedAt === undefined) return;
  inputWaitStartedAt.delete(key);
  await addTurnInputWait(sessionId, turnId, Date.now() - startedAt);
}

export default defineHook({
  events: {
    async "turn.started"(event, ctx) {
      try {
        const userId = userIdOf(ctx);
        if (!userId) return;
        await openAnimationTurn({
          userId,
          sessionId: ctx.session.id,
          turnId: event.data.turnId,
          startedAt: new Date(event.meta.at),
        });
      } catch (error) {
        logError("turn.started", error);
      }
    },

    async "step.started"(event, ctx) {
      try {
        const { turnId, stepIndex, modelId } = event.data;
        track(
          modelByStep,
          stepKey(ctx.session.id, turnId, stepIndex),
          modelId
        );
        // A new step means the agent resumed: any human-input wait is over.
        await closeInputWait(ctx.session.id, turnId);
      } catch (error) {
        logError("step.started", error);
      }
    },

    async "step.completed"(event, ctx) {
      try {
        const userId = userIdOf(ctx);
        if (!userId) return;
        const { turnId, stepIndex, usage } = event.data;
        const model =
          modelByStep.get(stepKey(ctx.session.id, turnId, stepIndex)) ??
          process.env.ANIMATION_MODEL ??
          "desconocido";
        await meterAnimationStep({
          userId,
          sessionId: ctx.session.id,
          turnId,
          stepIndex,
          model,
          costUsd:
            typeof usage?.costUsd === "number" && Number.isFinite(usage.costUsd)
              ? usage.costUsd
              : null,
          inputTokens:
            typeof usage?.inputTokens === "number"
              ? usage.inputTokens
              : null,
          outputTokens:
            typeof usage?.outputTokens === "number"
              ? usage.outputTokens
              : null,
        });
      } catch (error) {
        logError("step.completed", error);
      }
    },

    async "turn.waiting"(event, ctx) {
      try {
        // Only human input pauses count as idle time; tasks are agent work.
        if (event.data.on !== "input") return;
        track(
          inputWaitStartedAt,
          turnKey(ctx.session.id, event.data.turnId),
          Date.now()
        );
      } catch (error) {
        logError("turn.waiting", error);
      }
    },

    async "turn.completed"(event, ctx) {
      try {
        const { turnId } = event.data;
        const sessionId = ctx.session.id;
        await closeInputWait(sessionId, turnId);
        await closeAnimationTurn(sessionId, turnId, new Date(event.meta.at));
        const userId = userIdOf(ctx);
        if (!userId) return;
        const costUsd = await getTurnCostUsd(sessionId, turnId);
        if (costUsd > 0) {
          await mirrorAnimationTurnExpense({
            userId,
            sessionId,
            turnId,
            model: process.env.ANIMATION_MODEL ?? null,
            costUsd,
          });
        }
      } catch (error) {
        logError("turn.completed", error);
      }
    },

    async "turn.failed"(event, ctx) {
      try {
        const { turnId } = event.data;
        const sessionId = ctx.session.id;
        await closeInputWait(sessionId, turnId);
        await closeAnimationTurn(sessionId, turnId, new Date(event.meta.at));
        const userId = userIdOf(ctx);
        if (!userId) return;
        const costUsd = await getTurnCostUsd(sessionId, turnId);
        if (costUsd > 0) {
          await mirrorAnimationTurnExpense({
            userId,
            sessionId,
            turnId,
            model: process.env.ANIMATION_MODEL ?? null,
            costUsd,
          });
        }
      } catch (error) {
        logError("turn.failed", error);
      }
    },

    async "turn.cancelled"(event, ctx) {
      try {
        const { turnId } = event.data;
        const sessionId = ctx.session.id;
        await closeInputWait(sessionId, turnId);
        await closeAnimationTurn(sessionId, turnId, new Date(event.meta.at));
        const userId = userIdOf(ctx);
        if (!userId) return;
        const costUsd = await getTurnCostUsd(sessionId, turnId);
        if (costUsd > 0) {
          await mirrorAnimationTurnExpense({
            userId,
            sessionId,
            turnId,
            model: process.env.ANIMATION_MODEL ?? null,
            costUsd,
          });
        }
      } catch (error) {
        logError("turn.cancelled", error);
      }
    },
  },
});
