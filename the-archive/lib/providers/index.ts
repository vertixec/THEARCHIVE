// Provider registry + the encoding that lets one `generations` row point at any
// provider without a schema change.
//
// The DB columns predate multi-provider support (`fal_request_id`,
// `fal_endpoint`). Rather than migrate a live table, non-FAL jobs store their
// endpoint PREFIXED with the provider id — `kie:google/nano-banana`. FAL
// endpoints never contain a colon, so decoding is unambiguous and every row
// written before KIE existed still reads back as FAL.

import { falProvider } from './fal';
import { kieProvider } from './kie';
import type { GenerationProvider } from './types';
import { DEFAULT_MODEL, providerForModel, type ProviderId } from '../modelCatalog';

export const PROVIDERS: Record<ProviderId, GenerationProvider> = {
  fal: falProvider,
  kie: kieProvider,
};

export function getProvider(id: ProviderId): GenerationProvider {
  return PROVIDERS[id] ?? falProvider;
}

export function providerFor(modelId: string | null | undefined): GenerationProvider {
  return getProvider(providerForModel(modelId));
}

/** Which providers currently have an API key configured. */
export function configuredProviders(): Record<ProviderId, boolean> {
  return {
    fal: falProvider.isConfigured(),
    kie: kieProvider.isConfigured(),
  };
}

/**
 * Where to park a reference image the user uploaded before picking a model.
 * Generation re-hosts references onto the model's own provider anyway (and
 * skips the copy when they already live there), so this only has to be a
 * durable public URL — which means the app keeps working with just ONE key
 * configured, whichever it is.
 */
export function stagingProvider(): GenerationProvider | null {
  const preferred = providerFor(DEFAULT_MODEL.image);
  if (preferred.isConfigured()) return preferred;
  return Object.values(PROVIDERS).find((provider) => provider.isConfigured()) ?? null;
}

/** Endpoint string as persisted on `generations.fal_endpoint`. */
export function encodeJobEndpoint(provider: ProviderId, endpoint: string): string {
  return provider === 'fal' ? endpoint : `${provider}:${endpoint}`;
}

/** Inverse of encodeJobEndpoint; anything unprefixed is a legacy FAL row. */
export function decodeJobEndpoint(stored: string): {
  provider: GenerationProvider;
  endpoint: string;
} {
  const separator = stored.indexOf(':');
  if (separator > 0) {
    const prefix = stored.slice(0, separator).toLowerCase();
    if (prefix !== 'fal' && prefix in PROVIDERS) {
      return {
        provider: PROVIDERS[prefix as ProviderId],
        endpoint: stored.slice(separator + 1),
      };
    }
  }
  return { provider: falProvider, endpoint: stored };
}

export { ProviderSubmitError } from './types';
export type { GenerationProvider, ProviderPoll } from './types';
