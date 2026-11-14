-- Adjuntos por turno de la conversación unificada del asistente: metadatos
-- (id del archivo en user_files, nombre, tipo, tamaño) y la descripción que
-- el modelo de visión extrajo al enviarse el turno. Idempotente.
ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
