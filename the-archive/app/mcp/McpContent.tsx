'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import { MCP_SCOPES, SCOPE_DESCRIPTIONS, type McpKeyRow, type McpScope } from '@/lib/mcp/scopes';
import type { Feature } from '@/lib/business';

type Props = {
  initialKeys: McpKeyRow[];
  baseUrl: string;
  tier: string;
  planName: string;
  features: Feature[];
};

const EXPIRY_CHOICES: { label: string; value: number | null }[] = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'Never', value: null },
];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function McpContent({ initialKeys, baseUrl, tier, planName, features }: Props) {
  const { showToast } = useToast();
  const [keys, setKeys] = useState<McpKeyRow[]>(initialKeys);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<McpScope[]>(['read']);
  const [expiry, setExpiry] = useState<number | null>(90);
  const [creating, setCreating] = useState(false);
  // The freshly minted token — shown once, then gone forever.
  const [newToken, setNewToken] = useState<string | null>(null);

  const endpoint = `${baseUrl}/api/mcp`;
  const canGenerate = features.includes('generate_image') || features.includes('generate_video');

  const claudeConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            'the-archive': {
              command: 'npx',
              args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:Bearer YOUR_KEY'],
            },
          },
        },
        null,
        2,
      ),
    [endpoint],
  );

  const copy = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        showToast(`${label} COPIED`);
      } catch {
        showToast('COULD NOT COPY — SELECT AND COPY MANUALLY');
      }
    },
    [showToast],
  );

  const toggleScope = (scope: McpScope) => {
    if (scope === 'read') return; // always on
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  };

  const createKey = async () => {
    if (!name.trim()) {
      showToast('NAME THE KEY FIRST');
      return;
    }
    setCreating(true);
    setNewToken(null);
    try {
      const response = await fetch('/api/account/mcp-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: expiry }),
      });
      const payload = await response.json();
      if (!response.ok) {
        showToast(String(payload?.error || 'COULD NOT CREATE THE KEY').toUpperCase());
        return;
      }
      setKeys((current) => [payload.key, ...current]);
      setNewToken(payload.token);
      setName('');
      showToast('KEY CREATED — COPY IT NOW');
    } catch {
      showToast('NETWORK ERROR');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (key: McpKeyRow) => {
    if (!window.confirm(`Revoke "${key.name}"? Any agent using it stops working immediately.`)) {
      return;
    }
    try {
      const response = await fetch(`/api/account/mcp-keys/${key.id}`, { method: 'DELETE' });
      if (!response.ok) {
        showToast('COULD NOT REVOKE THE KEY');
        return;
      }
      setKeys((current) => current.filter((item) => item.id !== key.id));
      showToast('KEY REVOKED');
    } catch {
      showToast('NETWORK ERROR');
    }
  };

  return (
    <main className="min-h-screen bg-dark px-6 py-16 text-white md:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Connect An Agent
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
          The Archive, Inside Your AI
        </h1>
        <p className="mt-6 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
          Give Claude, Cursor or any MCP client direct access to the archive: search the curated
          prompt library, pull full systems, save to moodboards and generate — from wherever you
          already work.
        </p>

        {/* ---- endpoint ---- */}
        <section className="mt-12 border border-white/10 p-6">
          <h2 className="font-bebas text-3xl uppercase tracking-wide">1 · Server URL</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto border border-white/10 bg-black/40 px-4 py-3 font-mono text-xs text-acid">
              {endpoint}
            </code>
            <button
              type="button"
              onClick={() => copy(endpoint, 'URL')}
              className="border border-white/15 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
            >
              Copy
            </button>
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/35">
            Transport: streamable HTTP · Auth: bearer token · Your plan: {planName} ({tier})
          </p>
        </section>

        {/* ---- create key ---- */}
        <section className="mt-8 border border-white/10 p-6">
          <h2 className="font-bebas text-3xl uppercase tracking-wide">2 · Create A Key</h2>

          <label className="mt-5 block font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="Claude Desktop — laptop"
              className="mt-2 w-full border border-white/15 bg-black/40 px-4 py-3 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-acid"
            />
          </label>

          <fieldset className="mt-6">
            <legend className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
              Permissions
            </legend>
            <div className="mt-3 grid gap-px border border-white/10 bg-white/10">
              {MCP_SCOPES.map((scope) => {
                const locked = scope === 'read';
                const unavailable = scope === 'generate' && !canGenerate;
                const checked = scopes.includes(scope) && !unavailable;
                return (
                  <label
                    key={scope}
                    className={`flex items-start gap-3 bg-dark p-4 ${unavailable ? 'opacity-40' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked || unavailable}
                      onChange={() => toggleScope(scope)}
                      className="mt-1 accent-acid"
                    />
                    <span>
                      <span className="block font-mono text-[11px] uppercase tracking-[0.2em] text-white">
                        {scope}
                        {locked && ' (always on)'}
                        {unavailable && ' (not in your plan)'}
                      </span>
                      <span className="mt-1 block font-mono text-[10px] leading-relaxed tracking-wide text-white/40">
                        {SCOPE_DESCRIPTIONS[scope]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/35">
              Start with read only. Add generate only for an agent you trust with your credits.
            </p>
          </fieldset>

          <div className="mt-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
              Expires
            </span>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={String(choice.value)}
                  type="button"
                  onClick={() => setExpiry(choice.value)}
                  className={`border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    expiry === choice.value
                      ? 'border-acid bg-acid text-black'
                      : 'border-white/15 text-white/50 hover:border-acid hover:text-acid'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={createKey}
            disabled={creating}
            className="mt-7 bg-acid px-8 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-black transition-colors hover:bg-white disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create Key'}
          </button>

          {newToken && (
            <div className="mt-6 border border-acid/60 bg-acid/5 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
                Copy it now — it is never shown again
              </p>
              <code className="mt-3 block overflow-x-auto break-all border border-white/10 bg-black/60 px-4 py-3 font-mono text-xs text-white">
                {newToken}
              </code>
              <button
                type="button"
                onClick={() => copy(newToken, 'KEY')}
                className="mt-3 border border-white/15 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
              >
                Copy Key
              </button>
            </div>
          )}
        </section>

        {/* ---- client setup ---- */}
        <section className="mt-8 border border-white/10 p-6">
          <h2 className="font-bebas text-3xl uppercase tracking-wide">3 · Point Your Client At It</h2>

          <h3 className="mt-5 font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
            Claude.ai / Claude Desktop — custom connector
          </h3>
          <p className="mt-2 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/40">
            Settings → Connectors → Add custom connector. Paste the server URL above and set the
            authorization header to <span className="text-white/70">Bearer YOUR_KEY</span>.
          </p>

          <h3 className="mt-7 font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
            Claude Code / Cursor — config file
          </h3>
          <pre className="mt-2 overflow-x-auto border border-white/10 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-white/80">
            {claudeConfig}
          </pre>
          <button
            type="button"
            onClick={() => copy(claudeConfig, 'CONFIG')}
            className="mt-3 border border-white/15 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
          >
            Copy Config
          </button>

          <h3 className="mt-7 font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
            Verify from a terminal
          </h3>
          <pre className="mt-2 overflow-x-auto border border-white/10 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-white/80">
{`curl -X POST ${endpoint} \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
          </pre>
        </section>

        {/* ---- existing keys ---- */}
        <section className="mt-8 border border-white/10 p-6">
          <h2 className="font-bebas text-3xl uppercase tracking-wide">Your Keys</h2>
          {keys.length === 0 ? (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-white/35">
              No keys yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-px border border-white/10 bg-white/10">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-col gap-3 bg-dark p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-white">
                      {key.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] tracking-wide text-white/40">
                      {key.token_prefix}… · [{key.scopes.join(', ')}] · created {formatDate(key.created_at)}
                      {' · '}
                      last used {key.last_used_at ? formatDate(key.last_used_at) : 'never'}
                      {key.expires_at ? ` · expires ${formatDate(key.expires_at)}` : ' · no expiry'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => revokeKey(key)}
                    className="self-start border border-white/15 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/50 transition-colors hover:border-red-500 hover:text-red-400"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/profile"
            className="border border-white/15 px-8 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
          >
            Back To Profile
          </Link>
        </div>
      </div>
    </main>
  );
}
