# Community Membership — Setup & Operation

How Skool community members get (and lose) access to THE ARCHIVE's members area
and their **800 monthly credits**.

## What a community member gets

- Access to the **Community** members hub: `Visuals`, `Workflows`, and `Drops`
  sub-tabs (non-members see a locked teaser with a CTA to join the Skool).
- **800 credits/month**, auto-refreshed on the 1st (use-it-or-lose-it).
- Their **purchased** credits (bought packs) are a separate bucket and never
  expire or get reset.

Credits are spent monthly-allowance-first, then purchased — so a member burns
the free 800 before touching anything they paid for.

---

## 1. Apply the database migration (once)

Run `supabase/community_monthly_credits.sql` in Supabase → SQL Editor. It:

- Adds `monthly_credits` + `monthly_credits_reset_at` to `user_credit_balances`.
- Adds `plans.monthly_credit_grant` (community = 800).
- Updates `spend_generation_credits` to debit the monthly bucket first.
- Adds `grant_community_credits_for_user(uuid)` (single user, immediate) and
  `grant_monthly_community_credits()` (all active members, cycle reset).
- Schedules the monthly reset via **pg_cron** (`0 6 1 * *`, the 1st of each
  month at 06:00 UTC).

> If pg_cron isn't enabled, enable it in Supabase → Database → Extensions, then
> re-run the file (it's idempotent).

---

## 2. Env vars (Vercel)

| Var | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Required. Used to grant/revoke and to load teaser previews. |
| `NEXT_PUBLIC_SKOOL_URL` | The join link used by the locked teaser CTA. Falls back to `NEXT_PUBLIC_VERTIX_OS_URL`. |
| `COMMUNITY_WEBHOOK_SECRET` | Shared secret so Skool/Zapier can call the membership endpoint. Only needed for the automated path. |

---

## 3. Granting access — MANUAL (now)

Use the membership endpoint. It promotes the profile to `community`, marks it
active, and grants the first 800 credits immediately (no waiting for the 1st).

The person must have **signed up** at THE ARCHIVE first (with the same email
they use in Skool), otherwise the endpoint returns 404.

As an admin (logged into THE ARCHIVE with `role='admin'`), call:

```bash
curl -X POST https://YOUR_DOMAIN/api/community/membership \
  -H "Content-Type: application/json" \
  --cookie "<your admin session cookies>" \
  -d '{ "email": "member@example.com", "action": "grant" }'
```

To remove someone (demote to `free`, zero their monthly allowance, keep their
purchased credits):

```bash
-d '{ "email": "member@example.com", "action": "revoke" }'
```

> Quick alternative with no endpoint: in Supabase set
> `profiles.access_tier = 'community'`, `status = 'active'`, `role = 'member'`,
> then run `select grant_community_credits_for_user('<user-uuid>');`.

---

## 4. Granting access — AUTOMATED (Skool → Zapier/Make → webhook)

The same endpoint accepts a shared-secret header, so no code change is needed
to automate joins/leaves later.

1. Set `COMMUNITY_WEBHOOK_SECRET` in Vercel.
2. In Zapier/Make, create two zaps:
   - **Skool: member joins** → POST to `/api/community/membership`
     with header `x-community-secret: <secret>` and body
     `{ "email": "{{member_email}}", "action": "grant" }`.
   - **Skool: member leaves / subscription ends** → same URL, `action: "revoke"`.

The endpoint is idempotent — re-granting an already-active member just refreshes
their allowance; re-revoking is a no-op.

---

## 5. The monthly reset

`grant_monthly_community_credits()` runs via pg_cron on the 1st. It sets every
active community member's `monthly_credits` back to 800 (overwrite, not add) and
logs a `community_monthly_grant` transaction. To run it manually:

```sql
select public.grant_monthly_community_credits();
```
