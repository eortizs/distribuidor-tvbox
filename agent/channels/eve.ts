import { Pool } from "pg";
import { localDev, type AuthFn } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import {
  findSessionUser,
  readSessionCookie,
} from "../../src/server/auth/session-lookup";

const MESSAGE_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 20;

const globalForEveAuth = globalThis as typeof globalThis & {
  __eveAuthPool?: Pool;
};

const messageBuckets = new Map<string, { count: number; resetAt: number }>();

function getPool(): Pool {
  if (!globalForEveAuth.__eveAuthPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new Pool({ connectionString, max: 2 });
    pool.on("error", (error) => {
      console.error("[eve] session pool error", error);
    });
    globalForEveAuth.__eveAuthPool = pool;
  }
  return globalForEveAuth.__eveAuthPool;
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
  userId: string
): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO eve_sessions (session_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE SET user_id = eve_sessions.user_id
     RETURNING user_id`,
    [sessionId, userId]
  );
  return result.rows[0]?.user_id === userId;
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

    const user = await findSessionUser(getPool(), token);
    if (!user) return null;

    const sessionId = sessionIdFromRequest(request);
    if (sessionId && !(await isSessionOwner(sessionId, user.id))) {
      return null;
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
