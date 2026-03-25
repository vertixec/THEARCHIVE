-- ============================================================
-- RLS POLICIES — THE ARCHIVE
-- Ejecutar en Supabase → SQL Editor
-- ============================================================
-- Este script:
--   1. Habilita RLS en todas las tablas críticas
--   2. Elimina políticas existentes para evitar duplicados
--   3. Crea políticas correctas para cada tabla
-- ============================================================


-- ============================================================
-- TABLA: profiles
-- Solo puedes leer/editar tu propio perfil
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);


-- ============================================================
-- TABLA: boards
-- Solo el dueño puede crear, leer, actualizar y borrar sus boards
-- ============================================================
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boards_select_own" ON boards;
DROP POLICY IF EXISTS "boards_insert_own" ON boards;
DROP POLICY IF EXISTS "boards_update_own" ON boards;
DROP POLICY IF EXISTS "boards_delete_own" ON boards;

CREATE POLICY "boards_select_own"
  ON boards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "boards_insert_own"
  ON boards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "boards_update_own"
  ON boards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "boards_delete_own"
  ON boards FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- TABLA: board_items
-- Solo puedes acceder a items de boards que te pertenecen
-- ============================================================
ALTER TABLE board_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_items_select_own" ON board_items;
DROP POLICY IF EXISTS "board_items_insert_own" ON board_items;
DROP POLICY IF EXISTS "board_items_delete_own" ON board_items;

CREATE POLICY "board_items_select_own"
  ON board_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM boards
      WHERE boards.id = board_items.board_id
        AND boards.user_id = auth.uid()
    )
  );

CREATE POLICY "board_items_insert_own"
  ON board_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM boards
      WHERE boards.id = board_items.board_id
        AND boards.user_id = auth.uid()
    )
  );

CREATE POLICY "board_items_delete_own"
  ON board_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM boards
      WHERE boards.id = board_items.board_id
        AND boards.user_id = auth.uid()
    )
  );


-- ============================================================
-- TABLA: user_likes
-- Solo puedes leer y modificar tus propios likes
-- ============================================================
ALTER TABLE user_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_likes_select_own" ON user_likes;
DROP POLICY IF EXISTS "user_likes_insert_own" ON user_likes;
DROP POLICY IF EXISTS "user_likes_delete_own" ON user_likes;

CREATE POLICY "user_likes_select_own"
  ON user_likes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_likes_insert_own"
  ON user_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_likes_delete_own"
  ON user_likes FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- TABLAS DE CONTENIDO: prompts, functional_prompts,
--                      community_visuals, workflows
-- Solo usuarios con status='active' pueden leer
-- Nadie puede insertar/modificar/borrar desde el cliente
-- ============================================================
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE functional_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompts_select_active_members" ON prompts;
DROP POLICY IF EXISTS "functional_prompts_select_active_members" ON functional_prompts;
DROP POLICY IF EXISTS "community_visuals_select_active_members" ON community_visuals;
DROP POLICY IF EXISTS "workflows_select_active_members" ON workflows;

CREATE POLICY "prompts_select_active_members"
  ON prompts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'active'
    )
  );

CREATE POLICY "functional_prompts_select_active_members"
  ON functional_prompts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'active'
    )
  );

CREATE POLICY "community_visuals_select_active_members"
  ON community_visuals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'active'
    )
  );

CREATE POLICY "workflows_select_active_members"
  ON workflows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'active'
    )
  );


-- ============================================================
-- VERIFICACIÓN — corre esto al final para confirmar
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'boards', 'board_items',
    'user_likes', 'prompts', 'functional_prompts',
    'community_visuals', 'workflows'
  )
ORDER BY tablename;
