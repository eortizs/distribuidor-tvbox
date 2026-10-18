#!/usr/bin/env node
// One-time (idempotent) backfill: mirrors every metered image generation into
// the per-user expense control, converting USD to MXN with the Banxico FIX
// rate of each generation's day (forward-filled, same semantics as
// src/server/banxico.ts). Re-runs skip already-mirrored generations through
// the unique expenses.source_image_id.
//
//   node db/backfill-image-expenses.mjs

import { randomUUID } from "node:crypto";
import { Client } from "pg";

const MX_TZ = "America/Mexico_City";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FETCH_PAD_DAYS = 10;

const compareDays = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function fetchFixRates(from, to) {
  const token = process.env.BANXICO_TOKEN;
  if (!token) throw new Error("BANXICO_TOKEN is not set");
  const response = await fetch(
    `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/${from}/${to}`,
    {
      signal: AbortSignal.timeout(10_000),
      headers: { "Bmx-Token": token, Accept: "application/json" },
    }
  );
  if (!response.ok) throw new Error(`banxico: HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  const points = payload?.bmx?.series?.[0]?.datos;
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error("banxico: empty series");
  }
  const parsed = points
    .map((point) => {
      const [d, m, y] = String(point.fecha).split("/");
      return { day: `${y}-${m}-${d}`, rate: Number(String(point.dato).replace(",", ".")) };
    })
    .filter((p) => DAY_RE.test(p.day) && Number.isFinite(p.rate) && p.rate > 0)
    .sort((a, b) => compareDays(a.day, b.day));
  // Forward-fill every calendar day in [from, to] with the last published rate.
  const rates = new Map();
  let index = 0;
  let current = parsed[0].rate;
  for (let day = from; compareDays(day, to) <= 0; day = addDays(day, 1)) {
    while (index < parsed.length && compareDays(parsed[index].day, day) <= 0) {
      current = parsed[index].rate;
      index += 1;
    }
    rates.set(day, current);
  }
  return rates;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (e.g. source .env or export it)");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const generations = await client.query(
    `SELECT id, user_id, prompt, model, cost_usd, created_at,
            to_char(created_at AT TIME ZONE $1, 'YYYY-MM-DD') AS day
       FROM image_generations
      WHERE cost_usd IS NOT NULL AND cost_usd > 0
      ORDER BY created_at`,
    [MX_TZ]
  );

  if (generations.rows.length === 0) {
    console.log("No metered image generations to backfill.");
  } else {
    const days = [...new Set(generations.rows.map((row) => row.day))].sort();
    const rates = await fetchFixRates(
      addDays(days[0], -FETCH_PAD_DAYS),
      days[days.length - 1]
    );

    let inserted = 0;
    let skipped = 0;
    let unconverted = 0;
    for (const row of generations.rows) {
      const costUsd = Number(row.cost_usd);
      const rate = rates.get(row.day) ?? null;
      const result = await client.query(
        `INSERT INTO expenses
           (id, user_id, description, category, amount, currency, exchange_rate,
            mxn_equivalent, spent_on, notes, created_by, created_at, updated_at, source_image_id)
         VALUES ($1, $2, $3, 'Imágenes', $4, 'USD', $5, $6, $7, $8, 'sistema', $9, $9, $10)
         ON CONFLICT (source_image_id) DO NOTHING`,
        [
          randomUUID(),
          row.user_id,
          `Imagen IA — ${String(row.prompt).replace(/\s+/g, " ").trim().slice(0, 120)}`,
          costUsd.toFixed(6),
          rate !== null ? rate.toFixed(6) : null,
          rate !== null ? (costUsd * rate).toFixed(6) : null,
          row.day,
          `Modelo: ${row.model}`,
          new Date(row.created_at).toISOString(),
          row.id,
        ]
      );
      if (result.rowCount === 0) skipped += 1;
      else {
        inserted += 1;
        if (rate === null) unconverted += 1;
      }
    }
    console.log(
      `Backfill: ${inserted} expense(s) created, ${skipped} already mirrored, ${unconverted} without FIX rate.`
    );
  }
} finally {
  await client.end();
}
