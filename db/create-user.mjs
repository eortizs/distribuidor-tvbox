#!/usr/bin/env node
// Creates or updates an auth user: node db/create-user.mjs <email> <password> <admin|distribuidor>
// The login is always an email account; every new account also gets its
// umeJSON "Cuenta" entity (same shape the app writes on registration).

import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { Client } from "pg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const [rawUsername, password, role] = process.argv.slice(2);
const username = (rawUsername ?? "").trim().toLowerCase();

if (!username || !password || !["admin", "distribuidor"].includes(role)) {
  console.error("Usage: node db/create-user.mjs <email> <password> <admin|distribuidor>");
  process.exit(1);
}

if (!EMAIL_RE.test(username)) {
  console.error("Login must be a valid email account");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (e.g. source .env or export it)");
  process.exit(1);
}

if (password.length < 6) {
  console.error("Password must be at least 6 characters");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const passwordHash = `scrypt:16384:8:1:${salt.toString("base64")}:${hash.toString("base64")}`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  const existing = await client.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rowCount > 0) {
    await client.query("UPDATE users SET password_hash = $2, role = $3 WHERE username = $1", [username, passwordHash, role]);

    const accounts = await client.query(
      `SELECT id, version, doc->'dynamicProperties'->>'role' AS current_role
         FROM entities
        WHERE entity_name = 'Cuenta'
          AND doc @> jsonb_build_object('dynamicProperties', jsonb_build_object('email', $1::text))
          AND deleted_at IS NULL`,
      [username]
    );
    for (const account of accounts.rows) {
      if (account.current_role === role) continue;
      const nowIso = new Date().toISOString();
      const updated = await client.query(
        `UPDATE entities
            SET doc = jsonb_set(
                  jsonb_set(doc, '{dynamicProperties,role}', to_jsonb($3::text), true),
                  '{lifecycle,updatedAt}', to_jsonb($4::text), true),
                version = version + 1,
                updated_at = now()
          WHERE id = $1 AND version = $2 AND deleted_at IS NULL`,
        [account.id, account.version, role, nowIso]
      );
      if (updated.rowCount === 0) {
        throw new Error(`Version conflict updating account entity ${account.id}; aborting`);
      }
      const seqResult = await client.query(
        "SELECT coalesce(max(seq), 0) + 1 AS seq FROM entity_events WHERE entity_id = $1",
        [account.id]
      );
      await client.query(
        `INSERT INTO entity_events (entity_id, seq, event_type, payload, actor, reason, occurred_at)
         VALUES ($1, $2, 'property.updated', $3::jsonb, 'system', $4, now())`,
        [
          account.id,
          seqResult.rows[0].seq,
          JSON.stringify({ diff: { role: { from: account.current_role, to: role } } }),
          "Role updated by create-user.mjs",
        ]
      );
    }
    console.log(`Updated ${role} '${username}'`);
  } else {
    const userId = randomUUID();
    await client.query(
      "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)",
      [userId, username, passwordHash, role]
    );

    const entityId = randomUUID();
    const now = new Date().toISOString();
    const doc = {
      id: entityId,
      entityName: "Cuenta",
      dynamicProperties: {
        email: username,
        userId,
        role,
        distribuidorId: userId,
      },
      lifecycle: { createdAt: now, updatedAt: now, version: 1 },
      state: {
        current: "active",
        statusLog: [{ status: "active", timestamp: now, reason: "Account created" }],
      },
      markdownDocumentation: `### Cuenta — ${username}\nCuenta con perfil '${role}'.`,
    };
    await client.query(
      `INSERT INTO entities (id, entity_name, doc, version, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, now(), now())`,
      [entityId, doc.entityName, JSON.stringify(doc)]
    );
    await client.query(
      `INSERT INTO entity_events (entity_id, seq, event_type, payload, actor, reason, occurred_at)
       VALUES ($1, 1, 'created', $2::jsonb, 'system', $3, now())`,
      [entityId, JSON.stringify({ entityName: doc.entityName, state: "active", source: "seed" }), "Account created"]
    );
    console.log(`Created ${role} '${username}' with account entity ${entityId}`);
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
