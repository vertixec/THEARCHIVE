-- ============================================================
-- THE ARCHIVE - Generación asíncrona (cola de fal)
-- Permite encolar la generación y finalizarla por polling, en vez de esperar
-- a fal dentro de una sola invocación serverless (clave en hosts con timeout
-- corto, p. ej. Vercel Hobby = 60s).
--
-- Flujo:
--   /api/generate         -> cobra créditos, encola en fal, inserta fila 'queued'
--   /api/generate/status  -> hace polling; al COMPLETED guarda result_url y suma
--                            uso; en fallo marca 'failed' y reembolsa.
-- Ya aplicado al proyecto en vivo vía MCP apply_migration.
-- ============================================================

alter table public.generations
  add column if not exists status text not null default 'completed'
    check (status in ('queued', 'completed', 'failed')),
  add column if not exists fal_request_id text,
  add column if not exists fal_endpoint text;

create index if not exists generations_user_status_idx
  on public.generations (user_id, status);
