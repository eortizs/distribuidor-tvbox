#!/usr/bin/env node
// Creates or updates an auth user: node db/create-user.mjs <username> <password> <admin|distribuidor>

import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { Client } from "pg";

const [username, password, role] = process.argv.slice(2);

if (!username || !password || !["admin", "distribuidor"].includes(role)) {
  console.error("Usage: node db/create-user.mjs <username> <password> <admin|distribuidor>");
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
  const existing = await client.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rowCount > 0) {
    await client.query("UPDATE users SET password_hash = $2, role = $3 WHERE username = $1", [username, passwordHash, role]);
    console.log(`Updated ${role} '${username}'`);
  } else {
    await client.query(
      "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)",
      [randomUUID(), username, passwordHash, role]
    );
    console.log(`Created ${role} '${username}'`);
  }
} finally {
  await client.end();
}
