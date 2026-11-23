#!/usr/bin/env node
// Aplica db/tenants-schema.sql a la base del panel. Uso:
//   node db/apply-tenants.mjs
// Lee DATABASE_URL_ADMIN (dueño de las tablas: las migraciones requieren
// ownership para DDL y BYPASS el RLS) con fallback a DATABASE_URL para
// entornos pre-tenancy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  if (process.env.DATABASE_URL_ADMIN) return;
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(root, ".env");
  try {
    const env = readFileSync(envPath, "utf8");
    for (const key of ["DATABASE_URL_ADMIN", "DATABASE_URL"]) {
      const line = env.split("\n").find((row) => row.startsWith(`${key}=`));
      if (line) process.env[key] = line.slice(`${key}=`.length).trim();
      if (process.env[key]) break;
    }
  } catch {
    // Sin .env legible: se valida abajo.
  }
}

loadEnv();

const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_ADMIN (o DATABASE_URL) is required");
  process.exit(1);
}

const sqlPath = path.join(root, "db", "tenants-schema.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("tenants-schema.sql aplicado.");
} finally {
  await client.end();
}
