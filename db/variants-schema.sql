-- Variantes derivadas de los archivos del usuario: la versión en baja
-- resolución ('low') y la miniatura de la galería ('thumb'). El binario vive
-- en disco junto al original, en <kind>/variants/<storedName>.<variant>.webp,
-- y esta tabla es su índice (tamaño y dimensiones reales de cada variante).
--
-- Las filas caen con su archivo (ON DELETE CASCADE); el fichero en disco lo
-- borra deleteUserFile, que es quien conoce la ruta.

CREATE TABLE IF NOT EXISTS user_file_variants (
  file_id     uuid NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  variant     text NOT NULL CHECK (variant IN ('low', 'thumb')),
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, variant)
);
