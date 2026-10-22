#!/usr/bin/env node
// Deletes the user's uploaded attachments (kind 'attachment') that are older
// than ATTACHMENT_TTL_DAYS (7 days by default) so the disk does not grow
// without bound: node db/sweep-attachments.mjs
//
// Attachments are the reference images uploaded from /herramientas/imagenes.
// Files of kind 'generated' (the images and deliverables the AI produces) are
// never touched: they are part of the user's gallery.

import { unlink } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_DAYS = Number(process.env.ATTACHMENT_TTL_DAYS ?? "7");
const root = process.env.USER_FILES_DIR ?? path.join(process.cwd(), "storage", "users");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (e.g. source .env or export it)");
  process.exit(1);
}

if (!Number.isFinite(TTL_DAYS) || TTL_DAYS <= 0) {
  console.error("ATTACHMENT_TTL_DAYS must be a positive number of days");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const result = await client.query(
    `SELECT id, user_id, stored_name
       FROM user_files
      WHERE kind = 'attachment'
        AND created_at < now() - ($1 || ' days')::interval
      ORDER BY created_at`,
    [String(TTL_DAYS)]
  );

  let removed = 0;
  let bytes = 0;
  for (const row of result.rows) {
    const userId = row.user_id;
    if (!UUID_RE.test(userId)) {
      console.error(`Skipping invalid user id: ${userId}`);
      continue;
    }
    const target = path.join(root, userId, "attachments", row.stored_name);
    await unlink(target).catch(() => {});
    // Variantes derivadas del adjunto, por si alguien pidió una versión
    // reducida de él (sus filas caen por la FK al borrar el archivo).
    await Promise.all(
      ["low", "thumb"].map((variant) =>
        unlink(
          path.join(root, userId, "attachments", "variants", `${row.stored_name}.${variant}.webp`)
        ).catch(() => {})
      )
    );
    await client.query("DELETE FROM user_files WHERE id = $1", [row.id]);
    removed += 1;
    bytes += Number(row.size_bytes ?? 0);
  }

  console.log(
    `Removed ${removed} attachment(s) older than ${TTL_DAYS} day(s) (${bytes} bytes) under ${root}`
  );
} finally {
  await client.end();
}
