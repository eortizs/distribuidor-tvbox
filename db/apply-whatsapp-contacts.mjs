#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL) {
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = env
    .split("\n")
    .find((row) => row.startsWith("DATABASE_URL_ADMIN="));
  if (line) {
    process.env.DATABASE_URL_ADMIN ??= line
      .slice("DATABASE_URL_ADMIN=".length)
      .trim();
  }
}

if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (in .env or environment)");
  process.exit(1);
}

const sql = readFileSync(
  path.join(root, "db", "whatsapp-contacts-schema.sql"),
  "utf8"
);

const client = new Client({
  connectionString:
    process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL,
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("whatsapp-contacts-schema.sql aplicado.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Error aplicando whatsapp-contacts:", error.message);
  process.exit(1);
} finally {
  await client.end();
}
