#!/usr/bin/env node
// Creates per-user storage folders for every existing account:
// node db/ensure-user-storage.mjs

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = process.env.USER_FILES_DIR ?? path.join(process.cwd(), "storage", "users");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (e.g. source .env or export it)");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const result = await client.query("SELECT id FROM users ORDER BY created_at");
  let created = 0;
  for (const row of result.rows) {
    const userId = row.id;
    if (!UUID_RE.test(userId)) {
      console.error(`Skipping invalid user id: ${userId}`);
      continue;
    }
    const userDir = path.join(root, userId);
    await mkdir(path.join(userDir, "attachments"), { recursive: true });
    await mkdir(path.join(userDir, "generated"), { recursive: true });
    created += 1;
  }
  console.log(`Ensured storage folders for ${created} user(s) under ${root}`);
} finally {
  await client.end();
}
