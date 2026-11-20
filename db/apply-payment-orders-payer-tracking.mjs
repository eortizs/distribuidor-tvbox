#!/usr/bin/env node
// Aplica db/payment-orders-payer-tracking-schema.sql a la base del panel. Uso:
//   node db/apply-payment-orders-payer-tracking.mjs
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

const sql = readFileSync(
  path.join(root, "db", "payment-orders-payer-tracking-schema.sql"),
  "utf8"
);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("payment-orders-payer-tracking-schema.sql aplicado.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Error aplicando payment-orders-payer-tracking:", error.message);
  process.exit(1);
} finally {
  await client.end();
}
