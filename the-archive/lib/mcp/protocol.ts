// Minimal, spec-faithful JSON-RPC 2.0 / MCP plumbing.
//
// We implement the protocol directly instead of pulling in the MCP SDK: the
// surface a tools-only server needs is small (initialize, tools/list,
// tools/call, ping), the SDK's transports assume a Node req/res pair rather
// than a Next.js Route Handler, and owning the parsing keeps every untrusted
// field validated in one readable place.

export const LATEST_PROTOCOL_VERSION = '2025-06-18';

/**
 * Versions we can speak. On `initialize` we echo the client's version when we
 * know it, otherwise we answer with our latest and let the client decide
 * whether to continue — which is exactly what the spec prescribes.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export const SERVER_INFO = {
  name: 'the-archive',
  title: 'THE ARCHIVE',
  version: '1.0.0',
} as const;

// Standard JSON-RPC 2.0 error codes.
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  /** Absent for notifications, which take no response. */
  id?: JsonRpcId;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId | null;
      error: { code: number; message: string; data?: unknown };
    };

/** A single text block — the only content type this server returns. */
export type TextContent = { type: 'text'; text: string };

export type ToolResult = {
  content: TextContent[];
  /**
   * Tool-level failures are reported here, NOT as JSON-RPC errors: the model
   * needs to see what went wrong so it can correct itself. JSON-RPC errors are
   * reserved for protocol-level problems.
   */
  isError?: boolean;
};

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

export function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

export type ParsedMessage =
  | { kind: 'request'; request: JsonRpcRequest & { id: JsonRpcId } }
  | { kind: 'notification'; request: JsonRpcRequest }
  | { kind: 'invalid'; id: JsonRpcId | null; code: number; message: string };

/**
 * Validate one untrusted JSON-RPC message. Batching was removed from MCP in
 * 2025-06-18, so arrays are rejected rather than half-supported.
 */
export function parseMessage(payload: unknown): ParsedMessage {
  if (Array.isArray(payload)) {
    return {
      kind: 'invalid',
      id: null,
      code: JSON_RPC_ERRORS.INVALID_REQUEST,
      message: 'Batched requests are not supported.',
    };
  }
  if (typeof payload !== 'object' || payload === null) {
    return {
      kind: 'invalid',
      id: null,
      code: JSON_RPC_ERRORS.INVALID_REQUEST,
      message: 'Request must be a JSON object.',
    };
  }

  const message = payload as Record<string, unknown>;
  const rawId = message.id;
  const id =
    typeof rawId === 'string' || (typeof rawId === 'number' && Number.isFinite(rawId))
      ? (rawId as JsonRpcId)
      : null;

  if (message.jsonrpc !== '2.0') {
    return {
      kind: 'invalid',
      id,
      code: JSON_RPC_ERRORS.INVALID_REQUEST,
      message: 'Only JSON-RPC 2.0 is supported.',
    };
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    return {
      kind: 'invalid',
      id,
      code: JSON_RPC_ERRORS.INVALID_REQUEST,
      message: 'A method name is required.',
    };
  }

  const params =
    typeof message.params === 'object' && message.params !== null && !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};

  if (id === null) {
    return { kind: 'notification', request: { jsonrpc: '2.0', method: message.method, params } };
  }
  return {
    kind: 'request',
    request: { jsonrpc: '2.0', method: message.method, id, params },
  };
}
