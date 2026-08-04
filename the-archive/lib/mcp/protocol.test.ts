import { describe, expect, it } from 'vitest';
import {
  JSON_RPC_ERRORS,
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  parseMessage,
} from './protocol';

describe('MCP JSON-RPC parsing', () => {
  it('accepts a well-formed request and keeps its id', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: { a: 1 } });
    expect(parsed.kind).toBe('request');
    if (parsed.kind !== 'request') return;
    expect(parsed.request.id).toBe(7);
    expect(parsed.request.method).toBe('tools/list');
    expect(parsed.request.params).toEqual({ a: 1 });
  });

  it('treats a message without an id as a notification', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(parsed.kind).toBe('notification');
  });

  it('rejects batches, which MCP removed in 2025-06-18', () => {
    const parsed = parseMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') return;
    expect(parsed.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
  });

  it('rejects a wrong protocol marker, a missing method and non-objects', () => {
    expect(parseMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }).kind).toBe('invalid');
    expect(parseMessage({ jsonrpc: '2.0', id: 1 }).kind).toBe('invalid');
    expect(parseMessage('nope').kind).toBe('invalid');
    expect(parseMessage(null).kind).toBe('invalid');
  });

  it('ignores params that are not a plain object', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', id: 1, method: 'ping', params: ['x'] });
    expect(parsed.kind).toBe('request');
    if (parsed.kind !== 'request') return;
    expect(parsed.request.params).toEqual({});
  });
});

describe('protocol version negotiation', () => {
  it('echoes a version we support', () => {
    expect(negotiateProtocolVersion('2024-11-05')).toBe('2024-11-05');
  });

  it('falls back to our latest for unknown or malformed versions', () => {
    expect(negotiateProtocolVersion('1999-01-01')).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(42)).toBe(LATEST_PROTOCOL_VERSION);
  });
});
