import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import {
  completeCreditOperation,
  incrementGenerationUsage,
  refundCreditOperation,
} from '@/lib/generationSecurity';
import {
  extractResultUrl,
  getApiKey,
  getErrorMessage,
  getFalErrorBody,
  getFalUserMessage,
  type FalResult,
  type GenerationType,
} from '@/lib/falGenerate';

export const runtime = 'nodejs';
export const maxDuration = 60;

type GenerationRow = {
  id: string;
  user_id: string;
  generation_type: GenerationType;
  status: 'queued' | 'completed' | 'failed';
  result_url: string | null;
  fal_request_id: string | null;
  fal_endpoint: string | null;
  model: string | null;
  credit_cost: number | null;
  credit_operation_id: string | null;
};

export async function GET(req: NextRequest) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'FAL API key is not configured' }, { status: 500 });
  }

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
    .select('id, user_id, generation_type, status, result_url, fal_request_id, fal_endpoint, model, credit_cost, credit_operation_id')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .maybeSingle<GenerationRow>();

  if (jobError) {
    return NextResponse.json({ error: 'Job lookup failed' }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Already finalized — return the terminal state.
  if (job.status === 'completed') {
    if (job.credit_operation_id) {
      await completeCreditOperation(job.credit_operation_id, job.id).catch((error) => {
        console.error('Credit completion retry failed:', error);
      });
    }
    return NextResponse.json({ status: 'completed', url: job.result_url });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ status: 'failed', error: 'Generation failed' });
  }

  if (!job.fal_request_id || !job.fal_endpoint) {
    return NextResponse.json({ status: 'queued' });
  }

  const type = job.generation_type;

  const refund = async (reason: string) => {
    if (!job.credit_operation_id) return;
    try {
      await refundCreditOperation(job.credit_operation_id, reason);
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: job.user_id, refundErr });
    }
  };

  // Claim the finalization atomically so concurrent polls can't double-count
  // usage or double-refund: only the poll that flips 'queued' -> X acts on it.
  const finalizeFailed = async (userMessage: string) => {
    const admin = createAdminClient();
    const { data: claimed } = await admin
      .from('generations')
      .update({ status: 'failed' })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id');
    if (claimed && claimed.length > 0) {
      await refund('generation_failed');
    }
    return NextResponse.json({ status: 'failed', error: userMessage });
  };

  fal.config({ credentials: apiKey });

  let statusValue: string;
  try {
    const queueStatus = await fal.queue.status(job.fal_endpoint, {
      requestId: job.fal_request_id,
    });
    statusValue = queueStatus.status;
  } catch (error) {
    console.error('FAL status error:', {
      endpoint: job.fal_endpoint,
      message: getErrorMessage(error),
    });
    // Transient lookup error — let the client keep polling rather than fail hard.
    return NextResponse.json({ status: 'queued' });
  }

  if (statusValue !== 'COMPLETED') {
    return NextResponse.json({ status: 'queued' });
  }

  // Completed on FAL — fetch the result.
  let resultUrl = '';
  try {
    const result = (await fal.queue.result(job.fal_endpoint, {
      requestId: job.fal_request_id,
    })) as FalResult;
    resultUrl = extractResultUrl(result);
  } catch (error) {
    const userMessage =
      getFalUserMessage(getFalErrorBody(error), type, false) ||
      'Generation failed. Please try again or use a different model.';
    console.error('FAL result error:', {
      endpoint: job.fal_endpoint,
      message: getErrorMessage(error),
      body: getFalErrorBody(error),
    });
    return finalizeFailed(userMessage);
  }

  if (!resultUrl) {
    return finalizeFailed('Generation produced no output. Please try again.');
  }

  // Claim completion atomically; only the winning poll records usage.
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin
    .from('generations')
    .update({ status: 'completed', result_url: resultUrl })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');

  if (claimError) {
    return NextResponse.json({ error: 'Could not finalize the job' }, { status: 500 });
  }

  if (claimed && claimed.length > 0) {
    if (job.credit_operation_id) {
      try {
        await completeCreditOperation(job.credit_operation_id, job.id);
      } catch (error) {
        console.error('Credit completion failed:', error);
        return NextResponse.json({ error: 'Could not finalize credits' }, { status: 500 });
      }
    }
    // One generation = 1 toward the monthly counter (written server-side).
    await incrementGenerationUsage(user.id, type, 1).catch((error) => {
      console.error('Usage increment failed (non-fatal):', error);
    });
  }

  return NextResponse.json({ status: 'completed', url: resultUrl });
}
