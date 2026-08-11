// Provider contract. Everything the generation pipeline needs from an upstream
// AI vendor, expressed so FAL and KIE AI are interchangeable.
//
// The pipeline is async everywhere: submit returns a request id immediately,
// then a poll (browser), a webhook (vendor push) or the cron sweeper finalizes
// the job. `poll` collapses "check status" + "fetch result" into one call
// because KIE returns both in a single request and FAL needs two.

import type { GenerationType, ProviderId } from '../modelCatalog';

export type ProviderPoll =
  /** Still running (or a transient lookup failure — callers keep waiting). */
  | { status: 'pending' }
  | { status: 'completed'; url: string }
  | { status: 'failed'; message: string };

export type SubmitParams = {
  /** Provider endpoint / model string, from the model catalog. */
  endpoint: string;
  input: Record<string, unknown>;
};

export type PollParams = {
  endpoint: string;
  requestId: string;
  type: GenerationType;
};

export class ProviderSubmitError extends Error {
  constructor(
    message: string,
    /** Raw vendor error body, for logs only — never shown to users. */
    readonly body: unknown = null,
    /** Message safe to surface to the user, when the vendor gave a useful one. */
    readonly userMessage: string | null = null,
  ) {
    super(message);
    this.name = 'ProviderSubmitError';
  }
}

export interface GenerationProvider {
  readonly id: ProviderId;
  /** Human name used in error copy and setup docs. */
  readonly label: string;

  /** True when the API key env var is present. */
  isConfigured(): boolean;

  /** Enqueue a job. Returns the vendor request/task id. */
  submit(params: SubmitParams): Promise<string>;

  /** One round trip: is it done, and if so what's the media URL. */
  poll(params: PollParams): Promise<ProviderPoll>;

  /**
   * Upload an image so the vendor can read it. Returns a public URL that the
   * vendor's models accept as a reference.
   */
  uploadImage(blob: Blob, fileName?: string): Promise<string>;

  /** True when a URL is already hosted by this provider (no re-upload needed). */
  hostsUrl(url: string): boolean;
}
