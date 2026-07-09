import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { secureCompare } from '@/lib/secureCompare';
import {
  finalizeGeneration,
  GENERATION_JOB_COLUMNS,
  type GenerationJob,
} from '@/lib/finalizeGeneration';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Sweeper: finalizes 'queued' generations that both the browser poll and the
// FAL webhook missed (tab closed + webhook delivery failed). Completed jobs
// get their media persisted and credits charged; jobs FAL still reports
// pending past STALE_CUTOFF_MS get failed + refunded so reserved credits are
// never stranded.
//
// Triggered by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is
// set; the same header lets you run it manually with curl.

const MIN_AGE_MS = 5 * 60 * 1000; // leave fresh jobs to the poll/webhook
const STALE_CUTOFF_MS = 6 * 60 * 60 * 1000; // FAL jobs never run this long
const BATCH_LIMIT = 15; // stay well inside the 60s function budget

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!secureCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();

  const { data: jobs, error } = await admin
    .from('generations')
    .select(GENERATION_JOB_COLUMNS)
    .eq('status', 'queued')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<GenerationJob[]>();

  if (error) {
    console.error('Sweeper: queued jobs lookup failed', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const summary = { scanned: jobs?.length ?? 0, completed: 0, failed: 0, still_queued: 0, errors: 0 };

  // Sequential on purpose: bounded memory (video downloads) and no FAL/DB
  // burst. The batch is capped, leftovers get picked up on the next run.
  for (const job of jobs ?? []) {
    try {
      const outcome = await finalizeGeneration(job, { failStaleAfterMs: STALE_CUTOFF_MS });
      if (outcome.status === 'completed') summary.completed += 1;
      else if (outcome.status === 'failed') summary.failed += 1;
      else if (outcome.status === 'queued') summary.still_queued += 1;
      else summary.errors += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('Sweeper: finalize crashed', { jobId: job.id, err });
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
