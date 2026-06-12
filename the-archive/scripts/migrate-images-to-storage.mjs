/**
 * migrate-images-to-storage.mjs
 *
 * Baja las imágenes alojadas en cdn.midjourney.com (que devuelve 403 al
 * optimizador de Next y se sirven full-res ~1.4MB c/u), las sube al bucket
 * público `gallery` de Supabase Storage bajo el prefijo `visuals/`, y reescribe
 * la columna image_url de cada fila para que apunte a Storage.
 *
 * Una vez migradas, las URLs viven en *.supabase.co → SÍ son fetcheables por el
 * optimizador de Next (o por las transformaciones de Storage), por lo que se
 * pueden servir como miniaturas WebP de ~30KB en vez de PNGs de 1.4MB.
 *
 * Uso:
 *   node scripts/migrate-images-to-storage.mjs --dry-run   # no escribe nada, solo reporta
 *   node scripts/migrate-images-to-storage.mjs             # ejecuta la migración
 *
 * Es idempotente: las filas cuyo image_url ya no apunta a Midjourney se omiten,
 * así que se puede re-ejecutar sin duplicar trabajo. Guarda un backup del mapeo
 * id -> url_original en scripts/mj-migration-backup.json antes de tocar la DB.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const BUCKET = 'gallery';
const PREFIX = 'visuals';
const MJ_HOST = 'cdn.midjourney.com';
const CONCURRENCY = 1;          // Cloudflare bloquea ráfagas concurrentes
const DELAY_MS = 600;           // pausa base entre descargas
const MAX_RETRIES = 4;
const BACKUP_PATH = 'scripts/mj-migration-backup.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tablas a migrar: { table, idCol, urlCol }
const TARGETS = [
  { table: 'prompts', idCol: 'id', urlCol: 'image_url' },
  { table: 'community_visuals', idCol: 'id', urlCol: 'image_url' },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('FAIL: faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Headers de navegador necesarios para pasar el Cloudflare bot-protection de MJ.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.midjourney.com/',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'same-site',
};

function isMidjourney(u) {
  return typeof u === 'string' && u.includes(MJ_HOST);
}

// Deriva una ruta estable y única en Storage a partir de la URL original.
// cdn.midjourney.com/<uuid>/0_0.png -> visuals/<uuid>_0_0.png
function storagePathFor(originalUrl) {
  const path = new URL(originalUrl).pathname.replace(/^\/+/, ''); // "<uuid>/0_0.png"
  const flat = path.replace(/\//g, '_'); // "<uuid>_0_0.png"
  return `${PREFIX}/${flat}`;
}

function publicUrlFor(storagePath) {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

// El fetch de Node (undici) recibe 403 de Cloudflare por su huella TLS;
// curl sí pasa, así que descargamos shelleando a curl.
async function downloadImage(originalUrl) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const buf = execFileSync(
        'curl',
        [
          '-sS', '--fail', '--max-time', '60',
          '-A', BROWSER_HEADERS['User-Agent'],
          '-H', `Referer: ${BROWSER_HEADERS.Referer}`,
          '-H', `Accept: ${BROWSER_HEADERS.Accept}`,
          originalUrl,
        ],
        { maxBuffer: 50 * 1024 * 1024 }
      );
      if (buf.byteLength < 1024) {
        lastErr = new Error(`sospechosamente pequeño (${buf.byteLength}b), posible challenge HTML`);
      } else {
        const contentType = originalUrl.endsWith('.webp')
          ? 'image/webp'
          : originalUrl.endsWith('.jpg') || originalUrl.endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png';
        return { buf, contentType };
      }
    } catch (err) {
      lastErr = new Error(`download via curl: ${err.message?.split('\n')[0]}`);
    }

    const backoff = 1500 * 2 ** (attempt - 1) + Math.random() * 800;
    await sleep(backoff);
  }
  throw lastErr;
}

async function migrateRow({ table, idCol, urlCol }, row, backup) {
  const id = row[idCol];
  const originalUrl = row[urlCol];
  const storagePath = storagePathFor(originalUrl);
  const newUrl = publicUrlFor(storagePath);

  if (DRY_RUN) {
    console.log(`DRY  ${table}#${id}  ${originalUrl}  ->  ${newUrl}`);
    return { status: 'dry' };
  }

  const { buf, contentType } = await downloadImage(originalUrl);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType, upsert: true });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  // backup ANTES de mutar la fila
  backup.push({ table, id, original_url: originalUrl, new_url: newUrl, bytes: buf.byteLength });
  writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));

  const { error: updErr } = await supabase
    .from(table)
    .update({ [urlCol]: newUrl })
    .eq(idCol, id);
  if (updErr) throw new Error(`update: ${updErr.message}`);

  console.log(`OK   ${table}#${id}  ${(buf.byteLength / 1024).toFixed(0)}KB  -> ${storagePath}`);
  await sleep(DELAY_MS + Math.random() * 400);
  return { status: 'migrated' };
}

// Cola con límite de concurrencia.
async function runPool(items, worker, concurrency) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx]);
      } catch (err) {
        results[idx] = { status: 'error', error: err.message };
        console.error(`ERR  ${items[idx]._label}: ${err.message}`);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log(DRY_RUN ? '== DRY RUN (no escribe nada) ==' : '== MIGRACIÓN EN VIVO ==');

  const backup = existsSync(BACKUP_PATH) ? JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) : [];

  let total = 0;
  const summary = { migrated: 0, dry: 0, error: 0, skipped: 0 };

  for (const target of TARGETS) {
    const { data, error } = await supabase
      .from(target.table)
      .select(`${target.idCol}, ${target.urlCol}`);
    if (error) {
      console.error(`FAIL leyendo ${target.table}: ${error.message}`);
      continue;
    }

    const pending = (data || []).filter((r) => isMidjourney(r[target.urlCol]));
    const alreadyDone = (data || []).length - pending.length;
    summary.skipped += alreadyDone;
    total += pending.length;
    console.log(`\n${target.table}: ${pending.length} por migrar, ${alreadyDone} ya migradas/sin MJ`);

    const labeled = pending.map((r) => ({ ...r, _label: `${target.table}#${r[target.idCol]}` }));
    const results = await runPool(labeled, (row) => migrateRow(target, row, backup), CONCURRENCY);
    for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  }

  console.log('\n== RESUMEN ==');
  console.log(`Por migrar (MJ): ${total}`);
  console.log(`Migradas: ${summary.migrated} | Dry: ${summary.dry} | Errores: ${summary.error} | Omitidas: ${summary.skipped}`);
  if (!DRY_RUN) console.log(`Backup del mapeo en ${BACKUP_PATH}`);
  if (summary.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
