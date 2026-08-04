// The MCP tool surface for THE ARCHIVE.
//
// Every tool declares the scope its key must carry AND the plan feature the
// user's tier must include. `listTools` filters on both, so a read-only key on
// a free account is never even shown the tools it could not call — and
// `callTool` re-checks regardless, because a client can always call a tool it
// was not offered.

import { createAdminClient } from '../supabaseAdmin';
import {
  MODEL_CREDIT_COSTS,
  type Feature,
} from '../business';
import { MODEL_OPTIONS, creditCostFor, normalizeSelection } from '../modelOptions';
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_MODEL } from '../falGenerate';
import { enqueueGeneration, MAX_PROMPT_LENGTH, MAX_REFERENCE_IMAGES } from '../generateJob';
import { checkRateLimit } from '../generationSecurity';
import { finalizeGeneration, GENERATION_JOB_COLUMNS, type GenerationJob } from '../finalizeGeneration';
import { errorResult, textResult, type ToolResult } from './protocol';
import { hasFeature, hasScope, planFor, type McpContext } from './auth';
import type { McpScope } from './keys';

// ------------------------------------------------------------
// Archive sources
// ------------------------------------------------------------

type SourceId = 'visuals' | 'systems' | 'workflows' | 'community';

type SourceSpec = {
  table: string;
  feature: Feature;
  label: string;
  /** Columns fetched for search/detail. */
  columns: string;
  /** Search fields with their weight (higher = stronger signal). */
  weights: Record<string, number>;
  /** Board item_type this source maps to (board_items has a CHECK). */
  boardItemType: 'visual' | 'system' | 'community' | 'workflow';
  idKind: 'bigint' | 'uuid';
};

const SOURCES: Record<SourceId, SourceSpec> = {
  visuals: {
    table: 'prompts',
    feature: 'view_visuals',
    label: 'Visuals',
    columns: 'id, volume, category, prompt_text, image_url, model, created_at',
    weights: { category: 3, volume: 2, model: 2, prompt_text: 1 },
    boardItemType: 'visual',
    idKind: 'bigint',
  },
  systems: {
    table: 'functional_prompts',
    feature: 'view_systems',
    label: 'Systems',
    columns: 'id, title, prompt_type, prompt_text, instructions, image_url, model, created_at',
    weights: { title: 4, prompt_type: 3, model: 2, prompt_text: 1, instructions: 1 },
    boardItemType: 'system',
    idKind: 'bigint',
  },
  workflows: {
    table: 'workflows',
    feature: 'view_workflows',
    label: 'Workflows',
    columns: 'id, name, use_cases, tools, link, image_url, created_at',
    weights: { name: 4, tools: 3, use_cases: 2 },
    boardItemType: 'workflow',
    idKind: 'uuid',
  },
  community: {
    table: 'community_visuals',
    feature: 'view_community',
    label: 'Community',
    columns: 'id, author, image_url, model, is_featured, created_at',
    weights: { author: 3, model: 2 },
    boardItemType: 'community',
    idKind: 'bigint',
  },
};

const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

// ------------------------------------------------------------
// Limits
// ------------------------------------------------------------

const SEARCH_LIMIT_MAX = 25;
const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_PREVIEW_CHARS = 320;
const SEARCH_SCAN_CAP = 600; // rows pulled per table before in-memory ranking
const CREATIONS_LIMIT_MAX = 50;
const MAX_BOARDS_PER_USER = 50;
const MAX_ITEMS_PER_BOARD = 500;

// Rate limits, per user. The generate buckets are deliberately the SAME
// buckets the web app uses, so an agent cannot be used to bypass them.
const RATE_LIMITS = {
  read: { bucket: 'mcp:read', limit: 120, window: 60 },
  write: { bucket: 'mcp:write', limit: 30, window: 60 },
  generate: { bucket: 'generate', limit: 10, window: 60 },
} as const;

// ------------------------------------------------------------
// Tool registry
// ------------------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  scope: McpScope;
  /** Feature the tier must grant; null when the tool is tier-agnostic. */
  feature: Feature | null;
  rateLimit: keyof typeof RATE_LIMITS;
  handler: (context: McpContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

/** Human-readable credit table, injected into descriptions so the model can
 *  reason about cost BEFORE spending the user's credits. */
function costSummary(type: 'image' | 'video'): string {
  return Object.entries(MODEL_OPTIONS)
    .filter(([, spec]) => spec.type === type)
    .map(([id, spec]) => {
      const costs = new Set<number>();
      const walk = (index: number, sel: Record<string, string>) => {
        if (index === spec.controls.length) {
          costs.add(spec.cost(sel));
          return;
        }
        for (const option of spec.controls[index].options) {
          walk(index + 1, { ...sel, [spec.controls[index].key]: option.value });
        }
      };
      walk(0, {});
      const values = [...costs].sort((a, b) => a - b);
      const range = values.length > 1 ? `${values[0]}-${values[values.length - 1]}` : `${values[0]}`;
      return `${id} (${range} credits)`;
    })
    .join(', ');
}

// ------------------------------------------------------------
// Argument helpers — every field from the model is untrusted
// ------------------------------------------------------------

function asString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asSource(value: unknown): SourceId | null {
  return typeof value === 'string' && (SOURCE_IDS as string[]).includes(value)
    ? (value as SourceId)
    : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coerce an untrusted id to the type its table actually uses. */
function coerceId(raw: unknown, kind: 'bigint' | 'uuid'): string | number | null {
  const value = String(raw ?? '').trim();
  if (kind === 'uuid') return UUID_RE.test(value) ? value : null;
  return /^\d{1,18}$/.test(value) ? Number(value) : null;
}

function allowedSources(context: McpContext): SourceId[] {
  return SOURCE_IDS.filter((id) => hasFeature(context, SOURCES[id].feature));
}

// ------------------------------------------------------------
// Search
// ------------------------------------------------------------

type ArchiveRow = Record<string, unknown> & { id: string | number };

/**
 * Ranking runs in memory rather than in SQL. Two reasons: the whole archive is
 * a few hundred curated rows (so a full scan costs nothing), and it keeps the
 * user's query completely out of any filter string — there is no PostgREST
 * `or=(...)` expression for a crafted query to break out of.
 *
 * If the archive ever grows past a few thousand rows, replace this with a
 * Postgres tsvector index and a parameterized `textSearch` call.
 */
function scoreRow(row: ArchiveRow, terms: string[], weights: Record<string, number>): number {
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const value = row[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    const haystack = value.toLowerCase();
    for (const term of terms) {
      if (!haystack.includes(term)) continue;
      // A term that starts the field is a much stronger signal than one buried
      // in the middle of a long prompt.
      score += haystack.startsWith(term) ? weight * 2 : weight;
    }
  }
  return score;
}

function tokenize(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2)
        .slice(0, 12),
    ),
  ];
}

function truncate(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function describeRow(source: SourceId, row: ArchiveRow, preview: boolean): string {
  const lines: string[] = [];
  const ref = `${source}:${row.id}`;

  switch (source) {
    case 'visuals':
      lines.push(`**[${ref}]** ${row.category || 'Untitled'}${row.volume ? ` — ${row.volume}` : ''}`);
      if (row.model) lines.push(`Model: ${row.model}`);
      lines.push(preview ? truncate(row.prompt_text, SEARCH_PREVIEW_CHARS) : String(row.prompt_text ?? ''));
      break;
    case 'systems':
      lines.push(`**[${ref}]** ${row.title || 'Untitled system'}${row.prompt_type ? ` — ${row.prompt_type}` : ''}`);
      if (row.model) lines.push(`Model: ${row.model}`);
      lines.push(preview ? truncate(row.prompt_text, SEARCH_PREVIEW_CHARS) : String(row.prompt_text ?? ''));
      if (!preview && row.instructions) lines.push(`\nInstructions: ${row.instructions}`);
      break;
    case 'workflows':
      lines.push(`**[${ref}]** ${row.name || 'Untitled workflow'}`);
      if (row.tools) lines.push(`Tools: ${row.tools}`);
      if (row.use_cases) {
        lines.push(preview ? truncate(row.use_cases, SEARCH_PREVIEW_CHARS) : String(row.use_cases));
      }
      if (!preview && row.link) lines.push(`Link: ${row.link}`);
      break;
    case 'community':
      lines.push(`**[${ref}]** by ${row.author || 'unknown'}${row.is_featured ? ' (featured)' : ''}`);
      if (row.model) lines.push(`Model: ${row.model}`);
      break;
  }

  if (row.image_url) lines.push(`Image: ${row.image_url}`);
  return lines.filter(Boolean).join('\n');
}

async function searchArchive(context: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = asString(args.query, 200);
  if (query.length < 2) {
    return errorResult('`query` must be at least 2 characters.');
  }

  const permitted = allowedSources(context);
  if (permitted.length === 0) {
    return errorResult('Your plan does not include access to any archive section.');
  }

  const requested = asSource(args.source);
  if (args.source != null && args.source !== 'all' && !requested) {
    return errorResult(`Unknown source. Use one of: ${SOURCE_IDS.join(', ')}, all.`);
  }
  if (requested && !permitted.includes(requested)) {
    return errorResult(
      `Your plan (${context.tier}) does not include ${SOURCES[requested].label}. Available: ${permitted.join(', ')}.`,
    );
  }

  const targets = requested ? [requested] : permitted;
  const limit = asInt(args.limit, SEARCH_LIMIT_DEFAULT, 1, SEARCH_LIMIT_MAX);
  const terms = tokenize(query);
  if (terms.length === 0) {
    return errorResult('`query` needs at least one word of 2+ characters.');
  }

  const admin = createAdminClient();
  const scored: { source: SourceId; row: ArchiveRow; score: number }[] = [];

  await Promise.all(
    targets.map(async (source) => {
      const spec = SOURCES[source];
      const { data, error } = await admin
        .from(spec.table)
        .select(spec.columns)
        .order('created_at', { ascending: false })
        .limit(SEARCH_SCAN_CAP)
        .returns<ArchiveRow[]>();

      if (error) {
        console.error(`MCP search failed for ${spec.table}:`, error);
        return;
      }
      for (const row of data ?? []) {
        const score = scoreRow(row, terms, spec.weights);
        if (score > 0) scored.push({ source, row, score });
      }
    }),
  );

  if (scored.length === 0) {
    return textResult(
      `No results for "${query}" in ${targets.join(', ')}.\n\nTry broader wording, or call list_archive_categories to see what the archive covers.`,
    );
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const body = top
    .map((hit) => `${describeRow(hit.source, hit.row, true)}\n[source: ${SOURCES[hit.source].label}]`)
    .join('\n\n---\n\n');

  return textResult(
    `${top.length} of ${scored.length} matches for "${query}":\n\n${body}\n\n` +
      'Call get_archive_item with the [source:id] reference for the full prompt text.',
  );
}

async function getArchiveItem(context: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const source = asSource(args.source);
  if (!source) {
    return errorResult(`\`source\` must be one of: ${SOURCE_IDS.join(', ')}.`);
  }
  const spec = SOURCES[source];
  if (!hasFeature(context, spec.feature)) {
    return errorResult(`Your plan (${context.tier}) does not include ${spec.label}.`);
  }

  const id = coerceId(args.id, spec.idKind);
  if (id === null) {
    return errorResult('`id` is not a valid identifier for this source.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(spec.table)
    .select(spec.columns)
    .eq('id', id)
    .maybeSingle<ArchiveRow>();

  if (error) {
    console.error('MCP get_archive_item failed:', error);
    return errorResult('Could not load that item.');
  }
  if (!data) return errorResult(`No ${spec.label} item with id ${String(id)}.`);

  return textResult(describeRow(source, data, false));
}

async function listCategories(context: McpContext): Promise<ToolResult> {
  const permitted = allowedSources(context);
  if (permitted.length === 0) {
    return errorResult('Your plan does not include access to any archive section.');
  }

  const admin = createAdminClient();
  const sections: string[] = [];

  if (permitted.includes('visuals')) {
    const { data } = await admin
      .from('prompts')
      .select('volume, category')
      .limit(SEARCH_SCAN_CAP)
      .returns<{ volume: string | null; category: string | null }[]>();
    const volumes = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      const volume = row.volume || 'Uncategorized';
      if (!volumes.has(volume)) volumes.set(volume, new Set());
      if (row.category) volumes.get(volume)!.add(row.category);
    }
    sections.push(
      `## Visuals (source: visuals)\n${[...volumes.entries()]
        .map(([volume, categories]) => `- ${volume}: ${[...categories].sort().join(', ') || '—'}`)
        .join('\n')}`,
    );
  }

  if (permitted.includes('systems')) {
    const { data } = await admin
      .from('functional_prompts')
      .select('prompt_type')
      .limit(SEARCH_SCAN_CAP)
      .returns<{ prompt_type: string | null }[]>();
    const types = new Map<string, number>();
    for (const row of data ?? []) {
      const type = row.prompt_type || 'other';
      types.set(type, (types.get(type) ?? 0) + 1);
    }
    sections.push(
      `## Systems (source: systems)\n${[...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `- ${type} (${count})`)
        .join('\n')}`,
    );
  }

  if (permitted.includes('workflows')) {
    const { data } = await admin
      .from('workflows')
      .select('name, tools')
      .limit(SEARCH_SCAN_CAP)
      .returns<{ name: string | null; tools: string | null }[]>();
    sections.push(
      `## Workflows (source: workflows)\n${(data ?? [])
        .map((row) => `- ${row.name}${row.tools ? ` — ${row.tools}` : ''}`)
        .join('\n')}`,
    );
  }

  if (permitted.includes('community')) {
    const { count } = await admin
      .from('community_visuals')
      .select('id', { count: 'exact', head: true });
    sections.push(`## Community (source: community)\n- ${count ?? 0} member visuals`);
  }

  return textResult(sections.join('\n\n'));
}

// ------------------------------------------------------------
// Account & creations
// ------------------------------------------------------------

async function getAccount(context: McpContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: balance } = await admin
    .from('user_credit_balances')
    .select('credits, monthly_credits, monthly_credits_reset_at')
    .eq('user_id', context.userId)
    .maybeSingle<{
      credits: number;
      monthly_credits: number;
      monthly_credits_reset_at: string | null;
    }>();

  const plan = planFor(context);
  const purchased = balance?.credits ?? 0;
  const monthly = balance?.monthly_credits ?? 0;

  const modelLines = Object.entries(MODEL_CREDIT_COSTS)
    .map(([model, cost]) => {
      const spec = MODEL_OPTIONS[model];
      return `- ${model} (${spec?.type ?? 'image'}): ${cost} credits at default options`;
    })
    .join('\n');

  return textResult(
    [
      `# Account`,
      `Tier: ${context.tier} (${plan.name})`,
      `API key: "${context.keyName}" with scopes [${context.scopes.join(', ')}]`,
      '',
      `## Credits`,
      `Spendable: ${monthly + purchased} (${monthly} monthly + ${purchased} purchased)`,
      monthly > 0 && balance?.monthly_credits_reset_at
        ? `Monthly allowance resets: ${balance.monthly_credits_reset_at}`
        : '',
      '',
      `## Plan features`,
      plan.features.map((feature) => `- ${feature}`).join('\n') || '- none',
      '',
      `## Model costs`,
      modelLines,
      '',
      'Spend is charged the moment a generation is queued and refunded automatically if it fails.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );
}

async function listCreations(context: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = asInt(args.limit, 10, 1, CREATIONS_LIMIT_MAX);
  const statusFilter = asString(args.status, 20);

  const admin = createAdminClient();
  let query = admin
    .from('generations')
    .select('id, prompt, model, generation_type, status, result_url, credit_cost, created_at')
    .eq('user_id', context.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (['queued', 'completed', 'failed'].includes(statusFilter)) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query.returns<
    {
      id: string;
      prompt: string;
      model: string;
      generation_type: string;
      status: string;
      result_url: string | null;
      credit_cost: number | null;
      created_at: string | null;
    }[]
  >();

  if (error) {
    console.error('MCP list_creations failed:', error);
    return errorResult('Could not load your creations.');
  }
  if (!data || data.length === 0) {
    return textResult('No generations yet.');
  }

  return textResult(
    data
      .map((row) =>
        [
          `**${row.id}** — ${row.status} · ${row.generation_type} · ${row.model} · ${row.credit_cost ?? '?'} credits`,
          truncate(row.prompt, 200),
          row.result_url ? `Result: ${row.result_url}` : '',
          row.created_at ? `Created: ${row.created_at}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n---\n\n'),
  );
}

// ------------------------------------------------------------
// Boards
// ------------------------------------------------------------

async function listBoards(context: McpContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('boards')
    .select('id, name, created_at, board_items(count)')
    .eq('user_id', context.userId)
    .order('created_at', { ascending: false })
    .limit(MAX_BOARDS_PER_USER)
    .returns<{ id: string; name: string; created_at: string; board_items: { count: number }[] }[]>();

  if (error) {
    console.error('MCP list_boards failed:', error);
    return errorResult('Could not load your boards.');
  }
  if (!data || data.length === 0) {
    return textResult('No moodboards yet. save_to_board creates one on the fly.');
  }

  return textResult(
    data
      .map((board) => `- **${board.name}** (${board.board_items?.[0]?.count ?? 0} items) — id ${board.id}`)
      .join('\n'),
  );
}

async function saveToBoard(context: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const boardName = asString(args.board, 80);
  if (!boardName) return errorResult('`board` (a moodboard name) is required.');

  const rawSource = asString(args.source, 20);
  const admin = createAdminClient();

  // Resolve the item to save. We look the image URL up ourselves instead of
  // taking one from the caller, so a board can never be filled with arbitrary
  // third-party URLs.
  let imageUrl: string | null = null;
  let itemId: string;
  let itemType: 'visual' | 'system' | 'community' | 'workflow' | 'upload';

  if (rawSource === 'generation') {
    const id = coerceId(args.id, 'uuid');
    if (id === null) return errorResult('`id` must be a generation UUID.');
    const { data } = await admin
      .from('generations')
      .select('id, result_url, status')
      .eq('id', id)
      .eq('user_id', context.userId)
      .maybeSingle<{ id: string; result_url: string | null; status: string }>();
    if (!data) return errorResult('No generation of yours with that id.');
    if (data.status !== 'completed' || !data.result_url) {
      return errorResult('That generation has no result yet. Poll it with check_generation first.');
    }
    imageUrl = data.result_url;
    itemId = data.id;
    itemType = 'upload';
  } else {
    const source = asSource(rawSource);
    if (!source) {
      return errorResult(`\`source\` must be one of: ${SOURCE_IDS.join(', ')}, generation.`);
    }
    const spec = SOURCES[source];
    if (!hasFeature(context, spec.feature)) {
      return errorResult(`Your plan (${context.tier}) does not include ${spec.label}.`);
    }
    const id = coerceId(args.id, spec.idKind);
    if (id === null) return errorResult('`id` is not a valid identifier for this source.');

    const { data } = await admin
      .from(spec.table)
      .select('id, image_url')
      .eq('id', id)
      .maybeSingle<{ id: string | number; image_url: string | null }>();
    if (!data) return errorResult(`No ${spec.label} item with id ${String(id)}.`);
    imageUrl = data.image_url;
    itemId = String(data.id);
    itemType = spec.boardItemType;
  }

  // Find or create the board.
  const { data: existingBoard } = await admin
    .from('boards')
    .select('id, name')
    .eq('user_id', context.userId)
    .ilike('name', boardName)
    .maybeSingle<{ id: string; name: string }>();

  let boardId = existingBoard?.id ?? null;
  let created = false;

  if (!boardId) {
    const { count } = await admin
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', context.userId);
    if ((count ?? 0) >= MAX_BOARDS_PER_USER) {
      return errorResult(`Board limit reached (${MAX_BOARDS_PER_USER}). Reuse an existing board.`);
    }
    const { data: newBoard, error: boardError } = await admin
      .from('boards')
      .insert({ user_id: context.userId, name: boardName })
      .select('id')
      .single<{ id: string }>();
    if (boardError || !newBoard) {
      console.error('MCP board create failed:', boardError);
      return errorResult('Could not create the board.');
    }
    boardId = newBoard.id;
    created = true;
  }

  // Idempotent: saving the same item twice is a no-op, not a duplicate.
  const { data: duplicate } = await admin
    .from('board_items')
    .select('id')
    .eq('board_id', boardId)
    .eq('item_id', itemId)
    .eq('item_type', itemType)
    .maybeSingle<{ id: string }>();

  if (duplicate) {
    return textResult(`Already saved in "${boardName}".`);
  }

  const { count: itemCount } = await admin
    .from('board_items')
    .select('id', { count: 'exact', head: true })
    .eq('board_id', boardId);
  if ((itemCount ?? 0) >= MAX_ITEMS_PER_BOARD) {
    return errorResult(`"${boardName}" is full (${MAX_ITEMS_PER_BOARD} items).`);
  }

  const { error: itemError } = await admin.from('board_items').insert({
    board_id: boardId,
    item_id: itemId,
    item_type: itemType,
    image_url: imageUrl,
  });

  if (itemError) {
    console.error('MCP board item insert failed:', itemError);
    return errorResult('Could not save the item.');
  }

  return textResult(
    `Saved ${itemType} ${itemId} to "${boardName}"${created ? ' (board created)' : ''}.`,
  );
}

// ------------------------------------------------------------
// Generation
// ------------------------------------------------------------

async function runGeneration(
  context: McpContext,
  args: Record<string, unknown>,
  type: 'image' | 'video',
): Promise<ToolResult> {
  const prompt = asString(args.prompt, MAX_PROMPT_LENGTH);
  if (!prompt) return errorResult('`prompt` is required.');

  const model = asString(args.model, 60) || DEFAULT_MODEL[type];
  const catalogue = type === 'video' ? VIDEO_MODELS : IMAGE_MODELS;
  if (!(model in catalogue)) {
    return errorResult(`Unknown ${type} model "${model}". Available: ${Object.keys(catalogue).join(', ')}.`);
  }

  const references = Array.isArray(args.reference_image_urls)
    ? args.reference_image_urls.filter((url): url is string => typeof url === 'string')
    : [];
  if (references.length > MAX_REFERENCE_IMAGES) {
    return errorResult(`At most ${MAX_REFERENCE_IMAGES} reference images.`);
  }
  if (type === 'video' && references.length > 0) {
    return errorResult('Video models here are text-to-video; reference images are not supported.');
  }

  const selection = normalizeSelection(model, args.options);
  const estimated = creditCostFor(model, selection, type);

  const result = await enqueueGeneration({
    userId: context.userId,
    profile: context.profile,
    prompt,
    model,
    generationType: type,
    referenceImageUrls: references,
    options: args.options,
    tool: 'mcp',
  });

  if (!result.ok) {
    const suffix = result.refunded ? ' Your credits were refunded.' : '';
    return errorResult(`${result.message}${suffix}`);
  }

  return textResult(
    [
      `Queued ${type} generation.`,
      `Job id: ${result.jobId}`,
      `Model: ${result.model} · charged ${result.creditCost} credits (estimated ${estimated})`,
      `Credits left: ${result.creditsRemaining}`,
      '',
      'Generation is asynchronous. Call check_generation with the job id in ~10-30s (images) or ~1-3min (video).',
    ].join('\n'),
  );
}

async function checkGeneration(context: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const jobId = coerceId(args.job_id, 'uuid');
  if (jobId === null) return errorResult('`job_id` must be a generation UUID.');

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from('generations')
    .select(GENERATION_JOB_COLUMNS)
    .eq('id', jobId)
    // Ownership check: a job id alone must never expose someone else's work.
    .eq('user_id', context.userId)
    .maybeSingle<GenerationJob>();

  if (error) {
    console.error('MCP check_generation lookup failed:', error);
    return errorResult('Could not look up that job.');
  }
  if (!job) return errorResult('No generation of yours with that id.');

  const outcome = await finalizeGeneration(job);
  switch (outcome.status) {
    case 'completed':
      return textResult(`Completed.\nResult: ${outcome.url ?? '(no url)'}`);
    case 'failed':
      return errorResult(`Failed: ${outcome.error}. Credits were refunded.`);
    case 'error':
      return errorResult(`Temporary problem: ${outcome.error}. Try again shortly.`);
    default:
      return textResult('Still running. Poll again in a few seconds.');
  }
}

// ------------------------------------------------------------
// Definitions
// ------------------------------------------------------------

const GENERATION_OPTIONS_SCHEMA = {
  type: 'object',
  description:
    'Per-model options. Unknown or invalid values silently fall back to the model default.',
  properties: {
    quality: { type: 'string', enum: ['low', 'medium', 'high'], description: 'gpt-image-2 only. Drives cost: low=2, medium=12, high=48 credits.' },
    image_size: {
      type: 'string',
      enum: ['square_hd', 'landscape_4_3', 'portrait_4_3', 'landscape_16_9', 'portrait_16_9'],
      description: 'gpt-image-2 / flux-pro format.',
    },
    aspect_ratio: { type: 'string', description: 'nano-banana-pro (1:1, 16:9, 9:16, 4:3, 3:4) and video models (16:9, 9:16, 1:1).' },
    resolution: { type: 'string', description: 'nano-banana-pro (1K, 2K, 4K) or seedance (480p, 720p).' },
    duration: { type: 'string', enum: ['5', '10'], description: 'Video length in seconds. 10s costs double.' },
  },
  additionalProperties: false,
} as const;

export const TOOLS: ToolDef[] = [
  {
    name: 'search_archive',
    description:
      "Search THE ARCHIVE's curated library of AI prompts, systems, workflows and community visuals. " +
      'This is the primary tool: use it before writing an image or video prompt from scratch, so the ' +
      "output inherits the archive's proven styles and structures. Returns previews with [source:id] " +
      'references — pass those to get_archive_item for the full prompt text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, e.g. "cinematic product shot moody lighting".' },
        source: {
          type: 'string',
          enum: [...SOURCE_IDS, 'all'],
          description:
            'visuals = curated image prompts; systems = functional/utility prompts; workflows = multi-tool pipelines; community = member work. Defaults to every section your plan allows.',
        },
        limit: { type: 'integer', minimum: 1, maximum: SEARCH_LIMIT_MAX, description: `Max results (default ${SEARCH_LIMIT_DEFAULT}).` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Search the archive', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: searchArchive,
  },
  {
    name: 'get_archive_item',
    description:
      'Fetch one archive item in full: the complete prompt text, instructions, model and image URL. ' +
      'Use the [source:id] reference returned by search_archive.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: SOURCE_IDS, description: 'The section the item lives in.' },
        id: { type: 'string', description: 'Item id from the [source:id] reference.' },
      },
      required: ['source', 'id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get archive item', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: getArchiveItem,
  },
  {
    name: 'list_archive_categories',
    description:
      'Map of what the archive covers — volumes, categories, system types and workflows. ' +
      'Call this first when you do not know what to search for.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List archive categories', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: (context) => listCategories(context),
  },
  {
    name: 'get_account',
    description:
      'The connected account: plan tier, features, spendable credit balance and the credit cost of every model. ' +
      'Call this before generating so you can pick a model that fits the remaining budget.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Get account', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: (context) => getAccount(context),
  },
  {
    name: 'list_creations',
    description: "The user's own recent generations, with prompt, model, status, credit cost and result URL.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: CREATIONS_LIMIT_MAX, description: 'Default 10.' },
        status: { type: 'string', enum: ['queued', 'completed', 'failed'], description: 'Optional filter.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List creations', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: listCreations,
  },
  {
    name: 'check_generation',
    description:
      'Poll a queued generation and return its result URL once ready. Generations are asynchronous: ' +
      'images typically finish in 10-30s, videos in 1-3 minutes. Failed jobs are refunded automatically.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id returned by generate_image / generate_video.' } },
      required: ['job_id'],
      additionalProperties: false,
    },
    annotations: { title: 'Check generation', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'read',
    feature: null,
    rateLimit: 'read',
    handler: checkGeneration,
  },
  {
    name: 'list_boards',
    description: "The user's moodboards with item counts.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List boards', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'read',
    feature: 'create_moodboard',
    rateLimit: 'read',
    handler: (context) => listBoards(context),
  },
  {
    name: 'save_to_board',
    description:
      'Save an archive item or one of the user\'s own generations into a moodboard. ' +
      'The board is created if it does not exist. Saving the same item twice is a no-op.',
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Moodboard name. Created if missing.' },
        source: {
          type: 'string',
          enum: [...SOURCE_IDS, 'generation'],
          description: 'Where the item comes from. Use "generation" for the user\'s own results.',
        },
        id: { type: 'string', description: 'Item id, or the generation job id when source is "generation".' },
      },
      required: ['board', 'source', 'id'],
      additionalProperties: false,
    },
    annotations: { title: 'Save to board', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'write',
    feature: 'create_moodboard',
    rateLimit: 'write',
    handler: saveToBoard,
  },
  {
    name: 'generate_image',
    description:
      `Generate an image and CHARGE THE USER'S CREDITS. Models: ${costSummary('image')}. ` +
      'Cost is deducted the moment the job is queued and refunded if it fails. ' +
      'Prefer grounding the prompt in a search_archive result. Returns a job id — poll it with check_generation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: `The image prompt (max ${MAX_PROMPT_LENGTH} chars).` },
        model: { type: 'string', enum: Object.keys(IMAGE_MODELS), description: `Default ${DEFAULT_MODEL.image}.` },
        options: GENERATION_OPTIONS_SCHEMA,
        reference_image_urls: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_REFERENCE_IMAGES,
          description: 'Optional public image URLs to edit from. Switches the model to its edit endpoint.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    annotations: { title: 'Generate image (spends credits)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'generate',
    feature: 'generate_image',
    rateLimit: 'generate',
    handler: (context, args) => runGeneration(context, args, 'image'),
  },
  {
    name: 'generate_video',
    description:
      `Generate a video and CHARGE THE USER'S CREDITS — this is expensive. Models: ${costSummary('video')}. ` +
      'Always confirm with the user before calling. Cost is deducted at queue time and refunded on failure. ' +
      'Returns a job id — poll it with check_generation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: `The video prompt (max ${MAX_PROMPT_LENGTH} chars).` },
        model: { type: 'string', enum: Object.keys(VIDEO_MODELS), description: `Default ${DEFAULT_MODEL.video}.` },
        options: GENERATION_OPTIONS_SCHEMA,
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    annotations: { title: 'Generate video (spends credits)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'generate',
    feature: 'generate_video',
    rateLimit: 'generate',
    handler: (context, args) => runGeneration(context, args, 'video'),
  },
];

function isToolAvailable(context: McpContext, tool: ToolDef): boolean {
  if (!hasScope(context, tool.scope)) return false;
  if (tool.feature && !hasFeature(context, tool.feature)) return false;
  return true;
}

/** Tools this key + tier may actually use. */
export function listTools(context: McpContext) {
  return TOOLS.filter((tool) => isToolAvailable(context, tool)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

export async function callTool(
  context: McpContext,
  name: unknown,
  rawArgs: unknown,
): Promise<ToolResult> {
  const toolName = typeof name === 'string' ? name : '';
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return errorResult(`Unknown tool "${toolName}".`);
  }

  // Re-check authorization even though listTools already filtered: a client can
  // call any name it likes, and a membership can lapse between the two calls.
  if (!hasScope(context, tool.scope)) {
    return errorResult(
      `This API key lacks the "${tool.scope}" scope. Create a new key with that scope at THE ARCHIVE > Connect an agent.`,
    );
  }
  if (tool.feature && !hasFeature(context, tool.feature)) {
    return errorResult(`Your plan (${context.tier}) does not allow "${tool.name}".`);
  }

  const limit = RATE_LIMITS[tool.rateLimit];
  const outcome = await checkRateLimit(context.userId, limit.bucket, limit.limit, limit.window);
  if (outcome.status === 'limited') {
    return errorResult(`Rate limit reached. Retry in ${outcome.retryAfter}s.`);
  }
  if (outcome.status === 'error') {
    return errorResult('Rate limit check failed. Try again shortly.');
  }

  const args =
    typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};

  try {
    return await tool.handler(context, args);
  } catch (error) {
    // Never leak internals to the model; the detail goes to the server log.
    console.error(`MCP tool "${tool.name}" threw:`, error);
    return errorResult('That tool failed unexpectedly. Try again or adjust the arguments.');
  }
}
