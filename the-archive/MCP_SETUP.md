# MCP Server — THE ARCHIVE

Lets a member connect THE ARCHIVE to any MCP client (Claude, Claude Code, Cursor, …) so their
agent can search the curated prompt library, pull full systems, save to moodboards and generate —
without leaving the tool they already work in.

- **Endpoint:** `POST https://<your-domain>/api/mcp`
- **Transport:** Streamable HTTP, stateless (no session id, no SSE channel)
- **Auth:** `Authorization: Bearer tarc_…` personal API key
- **Setup page for members:** `/mcp` (linked from the profile header)

---

## 1. Deploy checklist

1. **Apply the migrations.** Both are already applied to project `tskmcvnbtexfqojoixuv`:
   - `supabase/mcp_api_keys.sql` — table `mcp_api_keys` + key-limit trigger + lockdown.
   - `supabase/mcp_rate_limit_buckets.sql` — adds `mcp:read` / `mcp:write` / `mcp:keys` to the
     server-side allowlist inside `server_consume_api_rate_limit`. Without it every MCP tool call
     fails with `invalid_rate_limit_bucket`.
2. **Env vars** — nothing new. It reuses `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   at least one generation provider key (`FAL_API_KEY` and/or `KIE_API_KEY` — see `KIE_SETUP.md`)
   and `NEXT_PUBLIC_SITE_URL`. If `NEXT_PUBLIC_SITE_URL` is unset, `/mcp` falls back
   to the request host for the copy-paste snippets. The `generate_image` / `generate_video` tools
   only advertise models whose provider actually has a key configured.
3. **Deploy.** `npx vercel deploy --prod` (this project does not auto-deploy on push).

---

## 2. How a member connects

They open `/mcp`, name a key, pick permissions, and copy the token **once** — it is never shown
again because only its SHA-256 is stored.

**Claude Code:**

```bash
claude mcp add --transport http the-archive https://<your-domain>/api/mcp \
  --header "Authorization: Bearer tarc_YOUR_KEY"
```

**Cursor / Claude Desktop** (via the `mcp-remote` bridge, which injects the header):

```json
{
  "mcpServers": {
    "the-archive": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<your-domain>/api/mcp",
        "--header", "Authorization:Bearer tarc_YOUR_KEY"
      ]
    }
  }
}
```

**Claude.ai — not supported yet.** The "Add custom connector" dialog accepts only a URL plus
optional OAuth client id/secret; there is no field for a static bearer token. Connecting without
one gets a 401, and the client then looks for `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`, which this server does not serve. Supporting it means
implementing OAuth 2.1 (protected-resource metadata, authorization-server metadata, dynamic client
registration, `/authorize` + `/token`). Until then, point members at the clients above.

**Verify from a terminal:**

```bash
curl -X POST https://<your-domain>/api/mcp \
  -H "Authorization: Bearer tarc_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 3. Tools

`tools/list` is filtered per request by the key's scopes **and** the account's tier, so a client is
never shown a tool it would be refused.

| Tool | Scope | Tier feature | What it does |
|---|---|---|---|
| `search_archive` | read | per source | Ranked search across visuals / systems / workflows / community |
| `get_archive_item` | read | per source | Full prompt text + instructions for one item |
| `list_archive_categories` | read | per source | The taxonomy, so an agent can orient itself |
| `get_account` | read | — | Tier, features, spendable credits, per-model credit costs |
| `list_creations` | read | — | The user's own generations |
| `check_generation` | read | — | Poll a job, return the result URL |
| `list_boards` | read | `create_moodboard` | Moodboards with item counts |
| `save_to_board` | write | `create_moodboard` | Save an archive item or own generation to a board |
| `generate_image` | generate | `generate_image` | Queue an image. **Spends credits.** |
| `generate_video` | generate | `generate_video` | Queue a video. **Spends credits.** |

Archive sources map to tier features: `visuals` → `view_visuals`, `systems` → `view_systems`,
`workflows` → `view_workflows`, `community` → `view_community`.

### Progressive disclosure

`search_archive` returns ~320-char previews with `[source:id]` references; `get_archive_item`
returns the full text. This keeps a broad search cheap in tokens and makes the agent fetch detail
only for what it actually uses.

---

## 4. Security model

**Tokens.** `tarc_` + 32 CSPRNG bytes (base64url). Only `sha256(token)` is stored, plus a 12-char
display prefix. A database dump cannot be replayed against the API. Malformed tokens are rejected
on shape before any query runs, and the stored digest is compared in constant time.

**Scopes (what the key may do).** Baked in at creation: `read` (always), `write`, `generate`.
A leaked read-only key from someone's editor config cannot spend a single credit. Scope is
re-checked on every call, not just at `tools/list`.

**Tier features (what the account may see).** Resolved from `profiles` on **every request** and
never cached in the token — revoking a Skool membership instantly takes community content away from
keys that were minted while it was active. Banned or inactive accounts are refused outright.

**Table lockdown.** `mcp_api_keys` has RLS enabled with **no policies** and the anon/authenticated
grants revoked: only the service role touches it, and every access goes through a route that has
already authenticated the session. (Supabase's linter reports this as
`rls_enabled_no_policy` at INFO level — that is the intended design, not an oversight.)

**No privilege escalation.** Key management (`/api/account/mcp-keys`) is **session**-authenticated,
so a token can never mint another token or extend its own scopes.

**Rate limits**, per user, sharing the same counters as the web app:

| Bucket | Limit |
|---|---|
| `mcp:read` | 120 / min |
| `mcp:write` | 30 / min |
| `generate` | 10 / min — the *same* bucket the panel uses, so an agent cannot bypass it |
| `mcp:keys` | 5 key creations / 5 min |

**Spend safety.** Generation goes through `lib/generateJob.ts`, the single implementation shared
with `/api/generate`: identical per-model pricing, the same atomic `server_reserve_generation_credits`
reservation, and automatic refund on reference failure, submit failure or a failed job. There is no
cheaper path through MCP.

**SSRF.** Reference image URLs are re-hosted through `prepareReferenceUrls`, which resolves DNS,
rejects private/link-local ranges, caps redirects, and validates content type and magic bytes.

**Injection.** Search ranking runs in memory over the (few hundred row) archive rather than being
interpolated into a PostgREST filter, so a crafted query has no expression to break out of. Item ids
are coerced to the column's actual type (bigint or UUID) before any query.

**Transport.** Cookies are never read by `/api/mcp` — bearer only. CORS is open precisely because
there are no ambient credentials for a hostile page to ride. Bodies over 256 KB are rejected before
parsing. `GET`/`DELETE` answer 405 (no SSE channel, no sessions), which is what the spec prescribes.

**Ownership.** `check_generation` and `save_to_board` scope every lookup to the caller's `user_id`,
so a guessed job id cannot expose another member's work.

---

## 5. Where the code lives

```
app/api/mcp/route.ts              JSON-RPC endpoint (initialize / ping / tools.*)
app/api/account/mcp-keys/         Key CRUD, session-authenticated
app/mcp/                          Member setup page + key manager UI
lib/mcp/protocol.ts               JSON-RPC 2.0 types, parsing, version negotiation
lib/mcp/keys.ts                   Mint / hash / verify / revoke  (server only)
lib/mcp/scopes.ts                 Scope vocabulary  (client-safe)
lib/mcp/auth.ts                   Bearer -> context (scopes + tier)
lib/mcp/tools.ts                  Tool definitions and handlers
lib/generateJob.ts                Shared generation enqueue (web + MCP)
supabase/mcp_api_keys.sql         Migration
```

---

## 6. Extending it

**A new tool:** add an entry to `TOOLS` in `lib/mcp/tools.ts` with its `scope`, `feature` and
`rateLimit`. Filtering, authorization re-checks, rate limiting and error containment are handled by
`callTool` — a handler only implements the behaviour.

**Scaling search:** ranking is a full scan today because the archive is a few hundred curated rows.
Past a few thousand, move to a Postgres `tsvector` index and a parameterized `textSearch` call —
the swap is contained to `searchArchive`.

**Charging for agent access:** `get_account` already reports tier and features, so a future
`view_mcp` feature in `PLAN_CONFIG` would gate the whole surface to paying tiers with a one-line
change in `authenticate`.
