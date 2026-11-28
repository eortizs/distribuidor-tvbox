-- Ticket de compra como documento de WhatsApp (2026-11-28): columnas del
-- adjunto en la cola de salida. Una fila con file_path se entrega como
-- DOCUMENTO (PDF) con caption = title+body; sin file_path sigue siendo texto.
-- Aditiva e idempotente: hereda los grants/RLS de la tabla.

ALTER TABLE wa_outbox ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE wa_outbox ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE wa_outbox ADD COLUMN IF NOT EXISTS file_mime text;
