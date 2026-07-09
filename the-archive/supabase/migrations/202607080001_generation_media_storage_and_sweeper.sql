-- ============================================================
-- THE ARCHIVE - Media durable + sweeper de generaciones huérfanas
--
-- 1) Bucket público `generations`: los resultados de FAL se COPIAN aquí al
--    finalizar (lib/resultMedia.ts), para que las galerías de los usuarios
--    no dependan de la retención de fal.media. Escritura solo vía service
--    role (bypassa RLS); sin policy de SELECT para impedir .list() masivo,
--    igual que los demás buckets tras storage_hardening.sql. getPublicUrl
--    sirve los archivos por el endpoint público.
--
-- 2) generations.result_storage_path: ruta del archivo en nuestro bucket
--    (null = todavía hotlink a FAL; el backfill
--    scripts/migrate-fal-results-to-storage.mjs los va cerrando).
--
-- 3) Índice parcial para el sweeper (/api/cron/finalize-generations), que
--    busca 'queued' viejos ordenados por created_at.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('generations', 'generations', true, 52428800) -- 50MB
on conflict (id) do nothing;

alter table public.generations
  add column if not exists result_storage_path text;

create index if not exists generations_queued_created_idx
  on public.generations (created_at)
  where status = 'queued';

-- El webhook de FAL resuelve la fila por fal_request_id.
create index if not exists generations_fal_request_idx
  on public.generations (fal_request_id)
  where fal_request_id is not null;
