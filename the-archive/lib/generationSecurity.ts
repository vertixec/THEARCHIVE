import type { SupabaseClient } from '@supabase/supabase-js';
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

export async function enforceRateLimit(
  supabase: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  const result = Array.isArray(data) ? (data[0] as RateLimitResult | undefined) : undefined;
  if (error || !result) {
    console.error('Rate limit check failed:', error);
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 500 });
  }
  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(result.retry_after || 1) } },
    );
  }
  return null;
}

export async function reserveCredits(params: {
  supabase: SupabaseClient;
  generationType: 'image' | 'video';
  amount: number;
  model: string;
  tool: string;
  prompt: string;
}) {
  const operationId = crypto.randomUUID();
  const { data, error } = await params.supabase.rpc('reserve_generation_credits', {
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
