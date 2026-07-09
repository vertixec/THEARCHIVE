/**
 * migrate-fal-results-to-storage.mjs
 *
 * Backfill del punto "media durable": copia los resultados de generaciones
 * COMPLETADAS que aún hotlinkean al CDN de FAL (fal.media / fal.run) al bucket
 * público `generations` de Supabase Storage, y reescribe result_url +
 * result_storage_path. Las generaciones nuevas ya se persisten al finalizar
 * (lib/resultMedia.ts); este script cierra el histórico y cualquier straggler
 * cuyo copiado falló en caliente.
 *
 * Uso:
 *   node scripts/migrate-fal-results-to-storage.mjs --dry-run  # solo reporta
 *   node scripts/migrate-fal-results-to-storage.mjs            # migra
 *
 * Idempotente: filtra por result_storage_path IS NULL y URLs de FAL; la ruta
 * destino es estable (userId/generationId.ext) y sube con upsert. Guarda un
 * backup id -> url_original en scripts/fal-results-migration-backup.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path = '.env.local') {
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (!process.env[key]) process.env[key] = valueParts.join('=');
  }
}

loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = 'generations';
const PAGE_SIZE = 200;
const MAX_BYTES = 50 * 1024 * 1024; // file_size_limit del bucket
const BACKUP_PATH = 'scripts/fal-results-migration-backup.json';

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('FAIL: faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isFalUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    const host = new URL(u).hostname;
    return host === 'fal.media' || host.endsWith('.fal.media') || host.endsWith('.fal.run') || host.endsWith('.fal.ai');
  } catch {
    return false;
  }
}

function extensionFor(contentType, generationType) {
  const normalized = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[normalized]) return { mime: normalized, ext: EXT_BY_MIME[normalized] };
  const fallback = generationType === 'video' ? 'video/mp4' : 'image/png';
  return { mime: fallback, ext: EXT_BY_MIME[fallback] };
}

async function fetchPendingPage(offset) {
  const { data, error } = await supabase
    .from('generations')
    .select('id, user_id, generation_type, result_url, result_storage_path')
    .eq('status', 'completed')
    .is('result_storage_path', null)
    .not('result_url', 'is', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(`lectura de generations: ${error.message}`);
  return data ?? [];
}

async function migrateRow(row, backup) {
  const original = row.result_url;
  const res = await fetch(original, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const { mime, ext } = extensionFor(res.headers.get('content-type'), row.generation_type);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('archivo vacío');
  if (buf.byteLength > MAX_BYTES) throw new Error(`excede 50MB (${buf.byteLength}b)`);

  const storagePath = `${row.user_id}/${row.id}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: true, cacheControl: '31536000' });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const newUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

  // backup ANTES de mutar la fila
  backup.push({ id: row.id, original_url: original, new_url: newUrl, bytes: buf.byteLength });
  writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));

  const { error: updErr } = await supabase
    .from('generations')
    .update({ result_url: newUrl, result_storage_path: storagePath })
    .eq('id', row.id)
    .eq('result_url', original); // no pisar si algo la cambió en paralelo
  if (updErr) throw new Error(`update: ${updErr.message}`);

  console.log(`OK   ${row.id}  ${(buf.byteLength / 1024).toFixed(0)}KB  -> ${storagePath}`);
}

async function main() {
  console.log(DRY_RUN ? '== DRY RUN (no escribe nada) ==' : '== MIGRACIÓN EN VIVO ==');
  const backup = existsSync(BACKUP_PATH) ? JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) : [];
  const summary = { migrated: 0, dry: 0, error: 0, skipped: 0 };

  // Fase 1: recolectar TODO el pendiente antes de mutar nada, para que la
  // paginación no se saltee filas cuando las migradas salen del filtro.
  const pending = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPendingPage(offset);
    pending.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`Candidatas (completed sin storage_path): ${pending.length}`);

  // Fase 2: procesar.
  for (const row of pending) {
    if (!isFalUrl(row.result_url)) {
      summary.skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`DRY  ${row.id}  ${row.result_url}`);
      summary.dry += 1;
      continue;
    }
    try {
      await migrateRow(row, backup);
      summary.migrated += 1;
    } catch (err) {
      summary.error += 1;
      console.error(`ERR  ${row.id}: ${err.message}`);
    }
  }

  console.log('\n== RESUMEN ==');
  console.log(`Migradas: ${summary.migrated} | Dry: ${summary.dry} | Errores: ${summary.error} | Omitidas (no-FAL): ${summary.skipped}`);
  if (!DRY_RUN) console.log(`Backup del mapeo en ${BACKUP_PATH}`);
  if (summary.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
