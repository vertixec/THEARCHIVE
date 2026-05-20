import { readFileSync } from 'node:fs';
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

function ok(label, detail = '') {
  console.log(`OK   ${label}${detail ? ` - ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.log(`WARN ${label}${detail ? ` - ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.log(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  fail('Missing Supabase credentials', 'Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function tableExists(table) {
  const { error } = await supabase.from(table).select('*').limit(1);
  if (!error) return true;
  if (String(error.message).toLowerCase().includes('could not find the table')) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return false;
  warn(`${table} check returned an unexpected error`, `${error.code ?? 'unknown'} ${error.message}`);
  return false;
}

async function columnExists(table, column) {
  const { error } = await supabase.from(table).select(column, { head: true }).limit(1);
  if (!error) return true;
  if (error.code === 'PGRST204' || String(error.message).includes(column)) return false;
  warn(`${table}.${column} check returned an unexpected error`, `${error.code ?? 'unknown'} ${error.message}`);
  return false;
}

async function countProfiles(label, filters) {
  let query = supabase.from('profiles').select('id', { head: true, count: 'exact' });
  for (const [column, value] of filters) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) {
    warn(`Could not count ${label}`, error.message);
    return null;
  }
  ok(label, String(count ?? 0));
  return count ?? 0;
}

console.log('THE ARCHIVE business migration preflight');
console.log(`Project: ${url.replace(/^https?:\/\//, '')}`);
console.log('');

const requiredCurrentTables = [
  'profiles',
  'user_generation_usage',
  'generations',
  'boards',
  'board_items',
  'user_likes',
  'prompts',
  'functional_prompts',
  'community_visuals',
  'workflows',
];

for (const table of requiredCurrentTables) {
  (await tableExists(table)) ? ok(`Existing table ${table}`) : fail(`Missing existing table ${table}`);
}

console.log('');
console.log('New business columns on profiles');
for (const column of ['access_tier', 'plan_id', 'skool_member_id', 'stripe_customer_id', 'onboarding_completed']) {
  (await columnExists('profiles', column)) ? ok(`profiles.${column} already exists`) : warn(`profiles.${column} missing`, 'migration will add it');
}

console.log('');
console.log('New business tables');
for (const table of ['plans', 'user_credit_balances', 'credit_transactions']) {
  (await tableExists(table)) ? ok(`${table} already exists`) : warn(`${table} missing`, 'migration will create it');
}

console.log('');
console.log('Profile impact estimates');
await countProfiles('profiles total', []);
await countProfiles('active members to map as community', [['status', 'active'], ['role', 'member']]);
await countProfiles('active admins', [['status', 'active'], ['role', 'admin']]);
await countProfiles('inactive profiles', [['status', 'inactive']]);

if (await tableExists('user_credit_balances')) {
  const { count, error } = await supabase
    .from('user_credit_balances')
    .select('user_id', { head: true, count: 'exact' });
  if (error) warn('Could not count user_credit_balances', error.message);
  else ok('credit balance rows', String(count ?? 0));
}

console.log('');
console.log('Recommendation: after business_foundation.sql, run supabase/business_access_hardening.sql to lock down free/community access.');
