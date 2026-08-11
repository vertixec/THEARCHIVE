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

// KIE AI task callback: fires when a queued task finishes, so generations get
// finalized (media persisted, credits completed/refunded) even if the user
// closed the tab and never polled /api/generate/status again. Mirrors
// /api/fal/webhook — see lib/finalizeGeneration for the shared logic.
//
// Security model: the payload is treated as an UNTRUSTED POKE. We only read
// data.taskId from it, look up OUR row, and re-fetch the authoritative state
// and result from KIE ourselves (inside finalizeGeneration). A forged call can
// therefore only make us re-check a job we own — it can never inject a fake
// result or trigger a refund that KIE's real state doesn't justify. KIE does
// not sign its callbacks, so when KIE_WEBHOOK_SECRET is set the callback URL
// carries ?token=<secret> and mismatches are rejected outright.
export async function POST(req: NextRequest) {
  const secret = process.env.KIE_WEBHOOK_SECRET;
  if (secret) {
    const token = req.nextUrl.searchParams.get('token') ?? '';
    if (!secureCompare(token, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  const data =
    body && typeof body === 'object' ? (body as { data?: unknown }).data : null;
  const taskId =
    data && typeof data === 'object' && typeof (data as { taskId?: unknown }).taskId === 'string'
      ? (data as { taskId: string }).taskId
      : null;

  if (!taskId) {
    // Nothing to act on; 200 so KIE doesn't retry a malformed delivery.
    return NextResponse.json({ ok: true, ignored: 'no_task_id' });
  }

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from('generations')
    .select(GENERATION_JOB_COLUMNS)
    .eq('fal_request_id', taskId)
    .maybeSingle<GenerationJob>();

  if (error) {
    // Transient DB problem — non-200 so KIE redelivers.
    console.error('KIE webhook: job lookup failed', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ ok: true, ignored: 'unknown_task' });
  }
  if (job.status !== 'queued') {
    return NextResponse.json({ ok: true, already: job.status });
  }

  const outcome = await finalizeGeneration(job);
  if (outcome.status === 'error') {
    // Retryable internal failure — let KIE redeliver.
    return NextResponse.json({ error: outcome.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, outcome: outcome.status });
}
