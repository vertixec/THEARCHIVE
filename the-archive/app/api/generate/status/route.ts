import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import {
  finalizeGeneration,
  GENERATION_JOB_COLUMNS,
  type GenerationJob,
} from '@/lib/finalizeGeneration';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Browser polling endpoint. The heavy lifting (FAL status/result, media
// persistence, credit completion/refund) lives in lib/finalizeGeneration so
// the FAL webhook and the cron sweeper finalize jobs the exact same way.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from('generations')
    .select(GENERATION_JOB_COLUMNS)
    .eq('id', jobId)
    .eq('user_id', user.id)
    .maybeSingle<GenerationJob>();

  if (jobError) {
    return NextResponse.json({ error: 'Job lookup failed' }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const outcome = await finalizeGeneration(job);

  switch (outcome.status) {
    case 'completed':
      return NextResponse.json({ status: 'completed', url: outcome.url });
    case 'failed':
      return NextResponse.json({ status: 'failed', error: outcome.error });
    case 'error':
      return NextResponse.json({ error: outcome.error }, { status: 500 });
    default:
      return NextResponse.json({ status: 'queued' });
  }
}
