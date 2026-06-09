import { fal } from '@fal-ai/client';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class ReferenceImageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImageAccessError';
  }
}

const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const FAL_HOST_PATTERNS = [/(^|\.)fal\.media$/i, /(^|\.)fal\.ai$/i, /(^|\.)fal\.run$/i];

function hasAscii(bytes: Uint8Array, offset: number, value: string) {
  return value.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

export function isSupportedRasterBytes(bytes: Uint8Array) {
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x89 && hasAscii(bytes, 1, 'PNG\r\n\u001a\n')) ||
    hasAscii(bytes, 0, 'GIF87a') ||
    hasAscii(bytes, 0, 'GIF89a') ||
    (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) ||
    (hasAscii(bytes, 4, 'ftyp') && (hasAscii(bytes, 8, 'avif') || hasAscii(bytes, 8, 'avis')))
  );
}

function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

function isPrivateIp(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  );
}

async function assertPublicUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ReferenceImageAccessError('Reference URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ReferenceImageAccessError('Reference URL is not allowed.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ReferenceImageAccessError('Private reference URLs are not allowed.');
  }
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ReferenceImageAccessError('Reference URL could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new ReferenceImageAccessError('Private reference URLs are not allowed.');
  }
  return url;
}

export function isFalHostedUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return FAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

async function fetchPublicReference(rawUrl: string) {
  let current = await assertPublicUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/*' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) {
        throw new ReferenceImageAccessError('Reference URL redirected too many times.');
      }
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new ReferenceImageAccessError('Reference URL could not be fetched.');
}

function assertImageContentType(contentType: string) {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (!normalized.startsWith('image/') || normalized === 'image/svg+xml') {
    throw new ReferenceImageAccessError('Reference URL must return a supported raster image.');
  }
  return normalized;
}

async function readLimitedBlob(response: Response, contentType: string) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_REFERENCE_BYTES) {
    throw new ReferenceImageAccessError('Reference image exceeds 15MB.');
  }
  if (!response.body) throw new ReferenceImageAccessError('Reference image is empty.');

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REFERENCE_BYTES) {
      await reader.cancel();
      throw new ReferenceImageAccessError('Reference image exceeds 15MB.');
    }
    chunks.push(value);
  }
  if (total === 0) throw new ReferenceImageAccessError('Reference image is empty.');
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!isSupportedRasterBytes(combined)) {
    throw new ReferenceImageAccessError('Reference is not a supported raster image.');
  }
  return new Blob([combined.buffer], { type: contentType });
}

export async function rehostUrlToFal(url: string): Promise<string> {
  const response = await fetchPublicReference(url);
  if (!response.ok) {
    throw new ReferenceImageAccessError(`Reference image is not accessible (${response.status}).`);
  }
  const contentType = assertImageContentType(response.headers.get('content-type') || '');
  return fal.storage.upload(await readLimitedBlob(response, contentType));
}

export async function rehostBlobToFal(blob: Blob): Promise<string> {
  if (blob.size <= 0 || blob.size > MAX_REFERENCE_BYTES || !blob.type.startsWith('image/') || blob.type === 'image/svg+xml') {
    throw new ReferenceImageAccessError('Only raster images up to 15MB are supported.');
  }
  const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!isSupportedRasterBytes(signature)) {
    throw new ReferenceImageAccessError('Reference is not a supported raster image.');
  }
  return fal.storage.upload(blob);
}

export async function prepareReferenceUrls(urls: string[]): Promise<string[]> {
  if (urls.length > 3) throw new ReferenceImageAccessError('A maximum of 3 reference images is allowed.');
  return Promise.all(urls.map((url) => rehostUrlToFal(url)));
}
