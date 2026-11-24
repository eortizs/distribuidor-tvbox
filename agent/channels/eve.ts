import { localDev, type AuthFn } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import {
  findSessionUser,
  readSessionCookie,
} from "../../src/server/auth/session-lookup";
import { pool, systemPool } from "../../src/server/db";
import { validateSessionHost } from "../../src/server/tenant/identity";

const MESSAGE_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 20;

const messageBuckets = new Map<string, { count: number; resetAt: number }>();

/** Host de la petición (x-forwarded-host del borde o host), sin puerto. */
function requestHostOf(request: Request): string {
  const raw =
    request.headers.get("x-forwarded-host")?.split(",")[0] ??
    request.headers.get("host") ??
    "";
  return raw.split(":")[0]?.trim().toLowerCase() ?? "";
}

function sessionIdFromRequest(request: Request): string | null {
  const { pathname } = new URL(request.url);
  const match = pathname.match(/\/eve\/v1\/session\/([^/]+)/);
  if (!match) return null;

  try {
    const sessionId = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

async function isSessionOwner(
  sessionId: string,
  tenantId: string,
  userId: string
): Promise<boolean> {
  // Import dinámico de runWithTenant (misma disciplina que src/server/db.ts:
  // context.ts fuera de la cadena estática de los módulos authored). El
  // upsert corre bajo el tenant del usuario: el trigger app_set_tenant_id
  // rellena tenant_id y RLS exige ese mismo contexto.
  const { runWithTenant } = await import("../../src/server/tenant/context");
  try {
    const result = await runWithTenant(tenantId, () =>
      pool.query(
        `INSERT INTO eve_sessions (session_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (session_id) DO UPDATE SET user_id = eve_sessions.user_id
         RETURNING user_id`,
        [sessionId, userId]
      )
    );
    return result.rows[0]?.user_id === userId;
  } catch (error) {
    // La fila de otro tenant es invisible bajo RLS: el upsert falla con
    // 42501 en vez de devolver "no es dueño".
    if ((error as { code?: string }).code === "42501") return false;
    throw error;
  }
}

function enforceMessageRateLimit(principalId: string): void {
  const now = Date.now();

  if (messageBuckets.size > 1000) {
    for (const [key, bucket] of messageBuckets) {
      if (bucket.resetAt <= now) messageBuckets.delete(key);
    }
  }

  const bucket = messageBuckets.get(principalId);
  if (!bucket || bucket.resetAt <= now) {
    messageBuckets.set(principalId, {
      count: 1,
      resetAt: now + MESSAGE_WINDOW_MS,
    });
    return;
  }

  bucket.count += 1;
  if (bucket.count > MESSAGE_LIMIT) {
    throw new Error(
      "Límite de mensajes alcanzado (20 por minuto). Espera un momento y vuelve a intentarlo."
    );
  }
}

function appSession(): AuthFn<Request> {
  return async (request) => {
    const token = readSessionCookie(request.headers.get("cookie"));
    if (!token) return null;

    // Lookup de sesión por token sobre systemPool (lista blanca del
    // tenancy): el rol de la app tiene RLS efectivo y sin contexto vería
    // 0 filas — el contexto viene DE la sesión.
    const user = await findSessionUser(systemPool, token);
    if (!user) return null;

    // Tenant suspendido: sin acceso al agente (igual que getSessionUser).
    if (user.tenantStatus === "suspended") return null;

    // Host ↔ tenant: la cookie de A en el host de B NO vale.
    if (!validateSessionHost(user.tenantId, requestHostOf(request))) {
      return null;
    }

    // Cuentas de plataforma no usan el agente del panel (creación incluida).
    if (!user.tenantId) return null;

    const sessionId = sessionIdFromRequest(request);
    if (sessionId) {
      if (!(await isSessionOwner(sessionId, user.tenantId, user.id))) {
        return null;
      }
    }

    return {
      authenticator: "reseller-session",
      principalId: user.id,
      principalType: "user",
      attributes: {
        username: user.username,
        role: user.role,
      },
    };
  };
}

export default eveChannel({
  auth: [
    // Valida la misma sesión httpOnly del panel contra Postgres.
    appSession(),
    // Abre el TUI de eve en local; no autentica nada en producción.
    localDev(),
  ],
  onMessage(ctx) {
    // Solo cuenta mensajes reales enviados al agente (no streams ni creaciones).
    const principalId = ctx.eve.caller?.principalId;
    if (principalId) enforceMessageRateLimit(principalId);
    return { auth: defaultEveAuth(ctx) };
  },
});
