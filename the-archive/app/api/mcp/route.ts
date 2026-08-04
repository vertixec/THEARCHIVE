// THE ARCHIVE — MCP server (Streamable HTTP transport).
//
// A single POST endpoint that speaks JSON-RPC 2.0. It is stateless: there is no
// session id and no server-initiated stream, so every request carries its own
// bearer token and can be served by any serverless instance. GET/DELETE answer
// 405, which is exactly what the spec prescribes for a server that offers
// neither an SSE channel nor session termination.
//
// Auth is a personal API key (see lib/mcp/keys.ts). Cookies are never read
// here, so a malicious website cannot ride a logged-in browser session into
// this endpoint — CORS is open precisely because there are no ambient
// credentials to steal.

import { NextRequest, NextResponse } from 'next/server';
import { authenticate, type McpContext } from '@/lib/mcp/auth';
import { callTool, listTools } from '@/lib/mcp/tools';
import {
  JSON_RPC_ERRORS,
  SERVER_INFO,
  failure,
  negotiateProtocolVersion,
  parseMessage,
  success,
  type JsonRpcId,
} from '@/lib/mcp/protocol';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Well over any legitimate tool call; stops a body-flood from reaching JSON.parse. */
const MAX_BODY_BYTES = 256 * 1024;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Accept',
  'Access-Control-Max-Age': '86400',
};

const BASE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'Cache-Control': 'no-store',
};

const INSTRUCTIONS = [
  'THE ARCHIVE is a curated library of AI image/video prompts, functional "systems" prompts, workflows and community visuals, plus a generation engine.',
  '',
  'Recommended flow:',
  '1. list_archive_categories — see what the library covers.',
  '2. search_archive — find proven prompts close to the user\'s intent.',
  '3. get_archive_item — pull the full prompt text of the best match.',
  '4. Adapt that prompt to the user\'s brief instead of writing one from scratch. This is the point of the archive.',
  '5. get_account then generate_image / generate_video, and poll check_generation.',
  '',
  'Generation spends the user\'s real credits. Always state the credit cost and get explicit confirmation before calling generate_video.',
].join('\n');

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: BASE_HEADERS });
}

function unauthorized(message: string, code: string) {
  return NextResponse.json(
    { error: 'unauthorized', error_description: message },
    {
      status: 401,
      headers: {
        ...BASE_HEADERS,
        'WWW-Authenticate': `Bearer realm="the-archive", error="${code}", error_description="${message}"`,
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// No SSE channel and no sessions to terminate — 405 is the specified answer.
export async function GET() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_description: 'This MCP server only accepts POST.' },
    { status: 405, headers: { ...BASE_HEADERS, Allow: 'POST, OPTIONS' } },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_description: 'This MCP server is stateless; there is no session to terminate.' },
    { status: 405, headers: { ...BASE_HEADERS, Allow: 'POST, OPTIONS' } },
  );
}

export async function POST(req: NextRequest) {
  // ---- 1. size guard, before parsing anything --------------------------
  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413);
  }

  const raw = await req.text().catch(() => null);
  if (raw === null) {
    return json(failure(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Could not read the request body.'), 400);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413);
  }

  // ---- 2. authenticate --------------------------------------------------
  // Every method, initialize included: this endpoint has no public surface.
  const auth = await authenticate(req.headers.get('authorization'));
  if (!auth.ok) {
    if (auth.failure.code === 'error') {
      return json({ error: 'server_error', error_description: auth.failure.message }, 500);
    }
    return unauthorized(auth.failure.message, auth.failure.code);
  }
  const context = auth.context;

  // ---- 3. parse the JSON-RPC message ------------------------------------
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(failure(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Body is not valid JSON.'), 400);
  }

  const parsed = parseMessage(payload);
  if (parsed.kind === 'invalid') {
    return json(failure(parsed.id, parsed.code, parsed.message), 400);
  }

  // Notifications get no response body, only an acknowledgement.
  if (parsed.kind === 'notification') {
    return new NextResponse(null, { status: 202, headers: BASE_HEADERS });
  }

  const { method, params, id } = parsed.request;

  try {
    return json(await dispatch(context, method, params ?? {}, id));
  } catch (error) {
    console.error('MCP dispatch failed:', { method, keyId: context.keyId, error });
    return json(failure(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal server error.'));
  }
}

async function dispatch(
  context: McpContext,
  method: string,
  params: Record<string, unknown>,
  id: JsonRpcId,
) {
  switch (method) {
    case 'initialize':
      return success(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        // Tools only. We deliberately do not advertise resources/prompts:
        // everything valuable here is expressible as a tool, and client
        // support for the other primitives is uneven.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });

    case 'ping':
      return success(id, {});

    case 'tools/list':
      // Filtered by the key's scopes AND the account's tier, so the model is
      // never shown a tool it would be refused.
      return success(id, { tools: listTools(context) });

    case 'tools/call':
      return success(id, await callTool(context, params.name, params.arguments));

    // Advertised capabilities do not include these; answer per spec rather
    // than pretending they exist.
    case 'resources/list':
    case 'resources/templates/list':
    case 'prompts/list':
      return failure(
        id,
        JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        `This server exposes tools only; "${method}" is not supported.`,
      );

    default:
      return failure(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method "${method}".`);
  }
}
