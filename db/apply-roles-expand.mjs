#!/usr/bin/env node
// Aplica db/roles-expand-schema.sql (Fase 2 Paso A: CHECK de users.role a
// cinco valores). Migraciones corren con el dueño (DATABASE_URL_ADMIN).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL) {
  const envPath = path.join(root, ".env");
  try {
    const env = readFileSync(envPath, "utf8");
    for (const key of ["DATABASE_URL_ADMIN", "DATABASE_URL"]) {
      const line = env.split("\n").find((row) => row.startsWith(`${key}=`));
      if (line) process.env[key] ??= line.slice(`${key}=`.length).trim();
      if (process.env[key]) break;
    }
  } catch {
    // Sin .env legible: se valida abajo.
  }
}

const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_ADMIN (o DATABASE_URL) is required");
  process.exit(1);
}

const sql = readFileSync(
  path.join(root, "db", "roles-expand-schema.sql"),
  "utf8"
);

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("roles-expand-schema.sql aplicado.");
} finally {
  await client.end();
}
