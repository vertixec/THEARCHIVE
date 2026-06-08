-- ============================================================
-- THE ARCHIVE - Storage hardening
-- Cierra hallazgos de los advisors + un bug de borrado cruzado:
--   1. Buckets públicos con SELECT amplia que permitía LISTAR todos los
--      archivos (avatars, gallery, moodboard-uploads).
--   2. moodboard-uploads: cualquier usuario autenticado podía subir/borrar
--      archivos de OTROS (policies sin scope por carpeta).
--   3. gallery: cualquier autenticado podía subir archivos arbitrarios.
--
-- Nota: los buckets son públicos, así que getPublicUrl sigue sirviendo los
-- archivos por el endpoint público (no pasa por RLS). El código no usa .list().
-- Ya aplicado al proyecto en vivo vía MCP apply_migration.
-- ============================================================

-- 1) Quitar las SELECT amplias (listado).
drop policy if exists "avatars_select" on storage.objects;
drop policy if exists "Public Images" on storage.objects;
drop policy if exists "Public read moodboard uploads" on storage.objects;

-- 2) moodboard-uploads: scope por carpeta de usuario (rutas `${uid}/${board}/file`).
drop policy if exists "Authenticated users can upload to moodboard" on storage.objects;
drop policy if exists "Authenticated users can delete moodboard uploads" on storage.objects;

create policy "moodboard_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'moodboard-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "moodboard_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'moodboard-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) gallery: subida solo para admins (contenido curado).
drop policy if exists "Auth Upload Images" on storage.objects;
create policy "gallery_insert_admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gallery'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- ============================================================
-- Verificación
-- ============================================================
select policyname, cmd, roles
from pg_policies
where schemaname='storage' and tablename='objects'
order by policyname;
