import { defineTool } from "eve/tools";
import { z } from "zod";

import { AppError } from "../../src/server/umejson/types";
import { pool } from "../../src/server/db";
import {
  saveUserFile,
  sanitizeFileName,
} from "../../src/server/storage/user-files";

const MAX_SAVE_BYTES = 250 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
};

const inputSchema = z.object({
  ruta: z
    .string()
    .min(1)
    .describe(
      "Ruta absoluta del archivo dentro del sandbox, p.ej. /workspace/out/effort.mp4"
    ),
  nombre: z
    .string()
    .min(1)
    .max(150)
    .optional()
    .describe("Nombre con el que se entrega el archivo al usuario"),
});

export default defineTool({
  description:
    "Entrega al usuario un archivo producido en el sandbox (video, audio, imagen o PDF): lo copia a su almacenamiento y devuelve el enlace /api/files/<id>. Úsalo siempre al terminar un render para entregar el resultado.",
  inputSchema,
  label: {
    start: ({ ruta }) => `Guardar archivo ${ruta.split("/").pop() ?? ruta}`,
  },
  async execute({ ruta, nombre }, ctx) {
    const extension = ruta.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) {
      throw new AppError(
        422,
        "unsupported_extension",
        `Extensión no permitida: .${extension}. Permitidas: ${Object.keys(MIME_BY_EXTENSION).join(", ")}`
      );
    }

    const principalId = ctx.session.auth.current?.principalId;
    if (!principalId) {
      throw new AppError(
        401,
        "missing_principal",
        "No hay un usuario autenticado en la sesión"
      );
    }

    const sandbox = await ctx.getSandbox();
    const bytes = await sandbox.readBinaryFile({ path: ruta });
    if (!bytes || bytes.byteLength === 0) {
      throw new AppError(
        404,
        "file_not_found",
        `No se encontró el archivo ${ruta} en el sandbox (o está vacío)`
      );
    }
    if (bytes.byteLength > MAX_SAVE_BYTES) {
      throw new AppError(
        413,
        "file_too_large",
        `El archivo (${bytes.byteLength} bytes) excede el límite de ${MAX_SAVE_BYTES} bytes`
      );
    }

    const fileName = sanitizeFileName(
      nombre ?? ruta.split("/").pop() ?? "archivo"
    );
    const file = await saveUserFile({
      userId: principalId,
      kind: "generated",
      fileName,
      mimeType,
      bytes,
      maxBytes: MAX_SAVE_BYTES,
    });

    // Index the delivery for the gallery. Best effort: a metering/indexing
    // failure must never break a delivery the user already paid for.
    try {
      await pool.query(
        `INSERT INTO animation_deliverables
           (id, user_id, file_id, session_id, turn_id, file_name, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          crypto.randomUUID(),
          principalId,
          file.id,
          ctx.session.id,
          ctx.session.turn.id,
          file.fileName,
          file.mimeType,
          file.sizeBytes,
        ]
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `guardar_archivo: gallery index failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      );
    }

    return {
      url: `/api/files/${file.id}`,
      nombre: file.fileName,
      bytes: file.sizeBytes,
      mimeType: file.mimeType,
    };
  },
});
