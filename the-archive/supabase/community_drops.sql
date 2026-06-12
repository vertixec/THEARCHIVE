-- ============================================================
-- THE ARCHIVE — Community Drops
-- Ejecutar en Supabase → SQL Editor
-- ============================================================
-- Crea la tabla `community_drops` (recursos exclusivos de members:
-- HTMLs, packs, plantillas, archivos) + RLS de lectura solo para
-- members activos, escritura solo admin.
--
-- Los ARCHIVOS no viven en la base: viven en Storage (bucket `drops`)
-- y la tabla solo guarda la URL. Por eso la plataforma no se pone
-- pesada por más drops que subas: el grid carga 60 filas livianas
-- (texto + thumbnail) y el archivo solo se transfiere cuando alguien
-- abre/descarga ese drop puntual.
-- ============================================================


-- ============================================================
-- TABLA: community_drops
-- ============================================================
CREATE TABLE IF NOT EXISTS public.community_drops (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  title         text NOT NULL,
  description   text,
  -- Tipo de recurso para el badge de la card: 'html' | 'pack' | 'template' | 'resource'
  kind          text NOT NULL DEFAULT 'resource',
  -- URL del archivo en Storage (HTML / .zip / etc.). Lo que se abre o descarga.
  file_url      text NOT NULL,
  -- Imagen de portada opcional para la card.
  thumbnail_url text,
  is_featured   boolean NOT NULL DEFAULT false
);

-- Orden del feed: featured primero, luego lo más reciente.
CREATE INDEX IF NOT EXISTS community_drops_feed_idx
  ON public.community_drops (is_featured DESC, created_at DESC);


-- ============================================================
-- RLS — lectura solo members activos, escritura solo desde
-- el servidor (admin client). Mismo patrón que community_visuals.
-- ============================================================
ALTER TABLE public.community_drops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_drops_select_active_members" ON public.community_drops;

CREATE POLICY "community_drops_select_active_members"
  ON public.community_drops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'active'
    )
  );


-- ============================================================
-- STORAGE — bucket `drops`
-- Público (getPublicUrl sirve el archivo sin pasar por RLS, igual que
-- `gallery`). Subida solo admin. Sin SELECT amplia para evitar listar
-- todo el bucket.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('drops', 'drops', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "drops_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "drops_delete_admin" ON storage.objects;

CREATE POLICY "drops_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'drops'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "drops_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'drops'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT schemaname, tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'community_drops';
