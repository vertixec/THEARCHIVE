-- ============================================================
-- MIGRACIÓN: Profile Page — username, is_public, timestamps
-- Ejecutar en Supabase → SQL Editor
-- ============================================================
-- Habilita perfiles públicos opcionales (/u/[username]),
-- agrega timestamps para "member since" y prepara cascades
-- para que delete-account borre todo lo del usuario.
-- ============================================================

-- 1. Columnas nuevas en profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username    text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_public   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- 2. Validación de username (a-z, 0-9, _, 3-20 chars)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS username_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');

-- 3. Índices
CREATE INDEX IF NOT EXISTS profiles_username_idx
  ON public.profiles (username);

CREATE INDEX IF NOT EXISTS profiles_public_idx
  ON public.profiles (is_public) WHERE is_public = true;

-- 4. Trigger de updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. RLS: lectura pública SOLO si is_public=true
DROP POLICY IF EXISTS "profiles_select_own"     ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_visible" ON public.profiles;

CREATE POLICY "profiles_select_visible"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR is_public = true);

-- 6. ON DELETE CASCADE en tablas dependientes
-- (asegura que borrar un usuario limpia todo)

-- Limpiar perfiles huérfanos (IDs sin usuario en auth.users)
DELETE FROM public.profiles
WHERE id NOT IN (SELECT id FROM auth.users);

-- user_likes → profiles
ALTER TABLE public.user_likes
  DROP CONSTRAINT IF EXISTS user_likes_user_id_fkey;
ALTER TABLE public.user_likes
  ADD CONSTRAINT user_likes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- boards → profiles
ALTER TABLE public.boards
  DROP CONSTRAINT IF EXISTS boards_user_id_fkey;
ALTER TABLE public.boards
  ADD CONSTRAINT boards_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- board_items → boards
ALTER TABLE public.board_items
  DROP CONSTRAINT IF EXISTS board_items_board_id_fkey;
ALTER TABLE public.board_items
  ADD CONSTRAINT board_items_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;
