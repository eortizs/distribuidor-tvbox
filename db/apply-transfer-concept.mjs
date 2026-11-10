#!/usr/bin/env node
// Aplica db/transfer-concept-schema.sql a la base del panel. Uso:
//   node db/apply-transfer-concept.mjs
// Lee DATABASE_URL de .env en la raíz del proyecto (mismo contrato que el
// resto de scripts de db/).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL) {
  const envPath = path.join(root, ".env");
  try {
    const env = readFileSync(envPath, "utf8");
    const line = env
      .split("\n")
      .find((row) => row.startsWith("DATABASE_URL="));
    if (line) process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).trim();
  } catch {
    // Sin .env legible: se valida abajo.
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (in .env or environment)");
  process.exit(1);
}

const sqlPath = path.join(root, "db", "transfer-concept-schema.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log("transfer-concept-schema.sql aplicado.");
} finally {
  await client.end();
}
