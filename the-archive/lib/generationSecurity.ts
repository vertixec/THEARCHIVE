import { NextResponse } from 'next/server';
import { createAdminClient } from './supabaseAdmin';

type ReserveResult = {
  ok: boolean;
  credits: number;
  operation_id: string;
};

type RateLimitResult = {
  allowed: boolean;
  retry_after: number;
};

export type RateLimitOutcome =
  | { status: 'allowed' }
  | { status: 'limited'; retryAfter: number }
  | { status: 'error' };

// Transport-agnostic rate limit check. Used directly by the MCP server (which
// answers in JSON-RPC, not HTTP status codes) and wrapped by enforceRateLimit
// for the REST routes, so both share one counter per (user, bucket).
export async function checkRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitOutcome> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('server_consume_api_rate_limit', {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  const result = Array.isArray(data) ? (data[0] as RateLimitResult | undefined) : undefined;
  if (error || !result) {
    console.error('Rate limit check failed:', error);
    return { status: 'error' };
  }
  if (!result.allowed) {
    return { status: 'limited', retryAfter: result.retry_after || 1 };
  }
  return { status: 'allowed' };
}

export async function enforceRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
) {
  const outcome = await checkRateLimit(userId, bucket, limit, windowSeconds);
  if (outcome.status === 'error') {
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 500 });
  }
  if (outcome.status === 'limited') {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfter) } },
    );
  }
  return null;
}

export async function reserveCredits(params: {
  userId: string;
  generationType: 'image' | 'video';
  amount: number;
  model: string;
  tool: string;
  prompt: string;
}) {
  const operationId = crypto.randomUUID();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('server_reserve_generation_credits', {
    p_user_id: params.userId,
    p_operation_id: operationId,
    p_generation_type: params.generationType,
    p_amount: params.amount,
    p_model: params.model,
    p_tool: params.tool,
    p_prompt: params.prompt,
  });
  const result = Array.isArray(data) ? (data[0] as ReserveResult | undefined) : undefined;
  if (error || !result) throw new Error(error?.message || 'Credit reservation failed');
  return result;
}

export async function incrementGenerationUsage(
  userId: string,
  generationType: 'image' | 'video',
  amount = 1,
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc('server_increment_generation_usage', {
    p_user_id: userId,
    p_generation_type: generationType,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
}

export async function setGenerationSaved(
  userId: string,
  generationId: string,
  isSaved: boolean,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('server_set_generation_saved', {
    p_user_id: userId,
    p_generation_id: generationId,
    p_is_saved: isSaved,
  });
  if (error || data !== true) throw new Error(error?.message || 'Generation save failed');
}

export async function completeCreditOperation(
  operationId: string,
  generationId: string | null = null,
  actualAmount: number | null = null,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('complete_generation_operation', {
    p_operation_id: operationId,
    p_generation_id: generationId,
    p_actual_amount: actualAmount,
  });
  if (error || data !== true) throw new Error(error?.message || 'Credit completion failed');
}

export async function refundCreditOperation(operationId: string, reason: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc('refund_generation_operation', {
    p_operation_id: operationId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
