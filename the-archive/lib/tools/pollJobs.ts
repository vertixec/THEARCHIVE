'use client';

// Client-side polling for async Tools runs. A tool POST now ENQUEUES jobs and
// returns their ids (see ToolEnqueueResponse); the slow image work finishes on
// the FAL queue and is finalized by /api/generate/status. We poll that endpoint
// for each job — same contract the freeform GeneratePanel uses — until every
// job completes, fails, or times out.

import type { ToolImageResult } from './types';

const POLL_INTERVAL = 3000;
const MAX_ATTEMPTS = 120; // ~6 minutes, matches freeform generation

export type ToolJobRef = { jobId: string; angle: string };

async function pollOne(job: ToolJobRef): Promise<ToolImageResult> {
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    const res = await fetch(`/api/generate/status?jobId=${encodeURIComponent(job.jobId)}`);
    if (!res.ok) continue; // transient; keep polling
    const payload = await res.json().catch(() => ({}));

    if (payload.status === 'completed' && payload.url) {
      return { url: payload.url, angle: job.angle };
    }
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'Generation failed');
    }
    // status === 'queued' -> keep polling
  }
  throw new Error('Generation timed out. Check your Creations shortly.');
}

export async function pollToolJobs(jobs: ToolJobRef[]): Promise<{
  results: ToolImageResult[];
  succeeded: number;
  requested: number;
  firstError: string | null;
}> {
  const settled = await Promise.allSettled(jobs.map((job) => pollOne(job)));
  const results: ToolImageResult[] = [];
  let firstError: string | null = null;
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      results.push(item.value);
    } else if (!firstError) {
      firstError = item.reason instanceof Error ? item.reason.message : 'Generation failed';
    }
  }
  return { results, succeeded: results.length, requested: jobs.length, firstError };
}
