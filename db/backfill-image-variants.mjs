#!/usr/bin/env node
// Deriva las variantes que faltan (versión en baja resolución y miniatura) de
// las imágenes que ya están en la galería: node db/backfill-image-variants.mjs
//
// Las imágenes generadas pesan 2-3 MB cada una; con la galería llena el
// celular se vuelve inservible. El servicio deriva las variantes al generar
// cada imagen, así que este script solo hace falta para las que ya estaban
// guardadas (o para las que quedaron a medias).
//
// Es idempotente: solo toca los archivos que no tienen variantes y vuelve a
// hacerlas si el fichero no existe en disco.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import sharp from "sharp";

const VARIANTS = [
  { name: "low", maxDimension: 1280, quality: 78 },
  { name: "thumb", maxDimension: 400, quality: 72 },
];
const MIME = "image/webp";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = Number(process.env.LIMIT ?? "0");
const root = process.env.USER_FILES_DIR ?? path.join(process.cwd(), "storage", "users");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (e.g. source .env or export it)");
  process.exit(1);
}

const kindDirName = (kind) => (kind === "attachment" ? "attachments" : "generated");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function derive(source, spec) {
  const { data, info } = await sharp(source, { failOn: "none" })
    .rotate()
    .resize({
      width: spec.maxDimension,
      height: spec.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: spec.quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const result = await client.query(
    `SELECT f.id, f.user_id, f.kind, f.stored_name, f.mime_type, wanted.variant
       FROM user_files f
       CROSS JOIN (VALUES ('low'), ('thumb')) AS wanted(variant)
       LEFT JOIN user_file_variants v
              ON v.file_id = f.id AND v.variant = wanted.variant
      WHERE f.kind = 'generated'
        AND f.mime_type LIKE 'image/%'
        AND v.variant IS NULL
      ORDER BY f.created_at
      ${LIMIT > 0 ? "LIMIT $1" : ""}`,
    LIMIT > 0 ? [LIMIT] : []
  );

  let done = 0;
  let skipped = 0;
  let bytes = 0;
  for (const row of result.rows) {
    if (!UUID_RE.test(row.user_id)) {
      console.error(`Skipping invalid user id: ${row.user_id}`);
      continue;
    }
    const dir = path.join(root, row.user_id, kindDirName(row.kind));
    const source = path.join(dir, row.stored_name);
    if (!(await exists(source))) {
      console.error(`Missing original for file ${row.id} (${source})`);
      skipped += 1;
      continue;
    }

    let original;
    try {
      original = await readFile(source);
    } catch (error) {
      console.error(`Unreadable original for file ${row.id}: ${error.message}`);
      skipped += 1;
      continue;
    }

    const spec = VARIANTS.find((item) => item.name === row.variant);
    if (!spec) continue;

    const variantDir = path.join(dir, "variants");
    await mkdir(variantDir, { recursive: true });
    try {
      const derived = await derive(original, spec);
      await writeFile(
        path.join(variantDir, `${row.stored_name}.${spec.name}.webp`),
        derived.data
      );
      await client.query(
        `INSERT INTO user_file_variants (file_id, variant, mime_type, size_bytes, width, height)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (file_id, variant) DO UPDATE
            SET mime_type = EXCLUDED.mime_type,
                size_bytes = EXCLUDED.size_bytes,
                width = EXCLUDED.width,
                height = EXCLUDED.height`,
        [row.id, spec.name, MIME, derived.data.byteLength, derived.width, derived.height]
      );
      bytes += derived.data.byteLength;
      done += 1;
    } catch (error) {
      console.error(`Variant ${spec.name} failed for file ${row.id}: ${error.message}`);
      skipped += 1;
    }
  }

  console.log(
    `Derived ${done} variant(s) (${(bytes / 1024 / 1024).toFixed(1)} MB), skipped ${skipped}`
  );
} finally {
  await client.end();
}
