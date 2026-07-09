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

// FAL queue webhook: fires when a queued job finishes, so generations get
// finalized (media persisted, credits completed/refunded) even if the user
// closed the tab and never polled /api/generate/status again.
//
// Security model: the payload is treated as an UNTRUSTED POKE. We only read
// request_id from it, look up OUR row, and re-fetch the authoritative status
// and result from FAL ourselves (inside finalizeGeneration). A forged call
// can therefore only make us re-check a job we own — it can never inject a
// fake result or trigger a refund that FAL's real state doesn't justify.
// Defense in depth: when FAL_WEBHOOK_SECRET is set, the callback URL carries
// ?token=<secret> and mismatches are rejected outright.
export async function POST(req: NextRequest) {
  const secret = process.env.FAL_WEBHOOK_SECRET;
  if (secret) {
    const token = req.nextUrl.searchParams.get('token') ?? '';
    if (!secureCompare(token, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  const requestId =
    body && typeof body === 'object' && typeof (body as { request_id?: unknown }).request_id === 'string'
      ? (body as { request_id: string }).request_id
      : null;

  if (!requestId) {
    // Nothing to act on; 200 so FAL doesn't retry a malformed delivery.
    return NextResponse.json({ ok: true, ignored: 'no_request_id' });
  }

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from('generations')
    .select(GENERATION_JOB_COLUMNS)
    .eq('fal_request_id', requestId)
    .maybeSingle<GenerationJob>();

  if (error) {
    // Transient DB problem — non-200 so FAL redelivers.
    console.error('FAL webhook: job lookup failed', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ ok: true, ignored: 'unknown_request' });
  }
  if (job.status !== 'queued') {
    return NextResponse.json({ ok: true, already: job.status });
  }

  const outcome = await finalizeGeneration(job);
  if (outcome.status === 'error') {
    // Retryable internal failure — let FAL redeliver.
    return NextResponse.json({ error: outcome.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, outcome: outcome.status });
}
