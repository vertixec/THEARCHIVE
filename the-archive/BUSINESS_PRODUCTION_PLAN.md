# THE ARCHIVE - Business and Production Plan

## 1. Product Direction

THE ARCHIVE is moving from a private companion platform for a paid Skool community into a public product with multiple access levels.

The current product value is not only AI generation. The stronger positioning is:

> A curated creative operating system for AI visuals, prompts, workflows, references, moodboards, and community inspiration.

The business model should protect the private community value while allowing outside users to try the platform, understand the product, and convert into paid credits, a paid plan, or the main community.

## 2. Current State

### Existing strengths

- Auth and profile system with Supabase.
- Private access gate through `profiles.status` and `profiles.role`.
- Content sections: Visuals, Systems, Community, Workflows.
- Personal tools: Favorites, Moodboard, Creations, Profile.
- Public profile foundation through `/u/[username]`.
- AI generation through FAL with image and video models.
- Basic usage tracking through `user_generation_usage`.
- Generation history through `generations`.

### Current limitations

- Access is binary: active member or blocked.
- Monthly limits are hardcoded in code:
  - `IMAGE_LIMIT = 10`
  - `VIDEO_LIMIT = 2`
- There is no plan system.
- There is no credit ledger.
- There is no billing system.
- There is no difference between a Skool member, a free outside user, and a future paid platform user.
- The middleware blocks almost every route for unauthenticated users.
- Public profiles and public marketing pages need clearer route rules.
- Credit spending is not yet concurrency-safe for production.

## 3. Recommended Business Model

Start simple. Do not launch with too many plans.

### Access tiers

| Tier | Audience | Goal | Suggested access |
| --- | --- | --- | --- |
| Visitor | Not logged in | Understand product | Landing, pricing, examples, selected public profiles |
| Free | Outside registered user | Try product | Small credit allowance, limited moodboards/favorites |
| Community | Paid Skool/community member | Reward existing members | Higher credits, full content library, community sections |
| Pro | Paid public user | Monetize outside audience | Monthly credits, advanced tools, higher limits |
| Admin | Internal team | Operate product | User management, credit adjustments, content ops |

### Suggested launch offers

#### Free

- 5 one-time image credits.
- 0 or 1 video credit.
- Limited saved moodboards.
- Limited favorites.
- Access to public previews only.
- Clear upgrade CTA.

#### Community

- 50 image credits per month.
- 5 video credits per month.
- Full access to Visuals, Systems, Community, Workflows.
- Private community badge.
- Better monthly value than public Pro.

#### Credit packs

- Image credit pack.
- Video credit pack.
- Credits should expire only if the business intentionally wants that. For trust, purchased credits should not expire at launch.

#### Pro, later

- Monthly subscription.
- Included monthly credits.
- Better generation limits.
- Advanced workflows.
- Potential commercial-use framing, depending on your legal terms.

## 4. Credit Strategy

The product should use credits instead of fixed monthly counters.

### Why

- Lets users buy more without changing plan.
- Lets you gift credits.
- Lets community members get monthly allocations.
- Lets different models cost different amounts.
- Creates a clean audit trail.

### Recommended credit costs

At launch, keep this understandable:

| Action | Cost |
| --- | --- |
| Image generation | 1 image credit |
| Image edit/reference generation | 1 image credit |
| Standard video generation | 5 image-equivalent credits or 1 video credit |
| Premium video generation | Higher cost, decided per model |

Long term, use one unified balance called `credits`, with model-specific costs. Short term, you can keep `image_credits` and `video_credits` if it makes the UI clearer.

## 5. Data Model

### Profiles

Extend `profiles` so business access is explicit.

```sql
alter table public.profiles
add column if not exists access_tier text default 'free',
add column if not exists plan_id text,
add column if not exists skool_member_id text,
add column if not exists stripe_customer_id text,
add column if not exists onboarding_completed boolean default false;
```

Recommended values:

- `role`: `user`, `member`, `admin`
- `status`: `active`, `inactive`, `banned`
- `access_tier`: `free`, `community`, `pro`, `admin`

### Plans

```sql
create table if not exists public.plans (
  id text primary key,
  name text not null,
  access_tier text not null,
  monthly_credits integer not null default 0,
  monthly_video_credits integer not null default 0,
  max_boards integer,
  max_favorites integer,
  can_access_systems boolean default false,
  can_access_workflows boolean default false,
  can_access_community boolean default false,
  is_public boolean default true,
  created_at timestamptz default now()
);
```

### Credit ledger

```sql
create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  amount integer not null,
  balance_after integer,
  credit_type text not null default 'general',
  reason text not null,
  related_generation_id uuid,
  stripe_payment_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
```

Reasons:

- `signup_bonus`
- `monthly_grant`
- `purchase`
- `generation_spend`
- `refund`
- `admin_adjustment`
- `migration`

### Optional user balance table

Use this for fast reads in the UI.

```sql
create table if not exists public.user_credit_balances (
  user_id uuid references auth.users(id) on delete cascade primary key,
  credits integer not null default 0,
  video_credits integer not null default 0,
  updated_at timestamptz default now()
);
```

The ledger is the source of truth. The balance table is a cache.

## 6. Permission Model

Create a central permission layer instead of scattering checks across components.

Example features:

- `view_visuals`
- `view_systems`
- `view_workflows`
- `view_community`
- `generate_image`
- `generate_video`
- `create_moodboard`
- `save_favorite`
- `public_profile`
- `admin_panel`

Recommended code location:

```txt
lib/access.ts
lib/credits.ts
```

Example shape:

```ts
type Feature =
  | 'view_visuals'
  | 'view_systems'
  | 'view_workflows'
  | 'view_community'
  | 'generate_image'
  | 'generate_video'
  | 'create_moodboard'
  | 'save_favorite'
  | 'admin_panel';
```

The API should enforce permissions server-side. The UI can hide buttons, but the server must be the authority.

## 7. Route Access Plan

### Public routes

- `/`
- `/login`
- `/auth/callback`
- `/auth/reset-password`
- `/pricing`
- `/terms`
- `/privacy`
- `/u/[username]`
- Selected public preview pages, if desired.

### Authenticated free routes

- `/profile`
- `/creations`
- `/favorites`, with limits
- `/moodboard`, with limits
- `/visuals`, if you want a preview library
- `/inactive-membership`, renamed later to something more general like `/upgrade`

### Community/pro routes

- `/systems`
- `/workflows`
- `/community`
- Full `/visuals`
- Full generation access based on credits

### Admin routes, future

- `/admin`
- `/admin/users`
- `/admin/credits`
- `/admin/content`
- `/admin/generations`

## 8. Required Code Changes

### High priority

- Replace hardcoded generation limits with plan/credit reads.
- Add `lib/access.ts`.
- Add `lib/credits.ts`.
- Change middleware from active-member-only to tier-aware route access.
- Make `/u/[username]` public if public profiles are part of acquisition.
- Update RLS policies for public profiles while preserving private user data.
- Add a server-side function or transaction for spending credits safely.
- Add an upgrade/pricing page.
- Add onboarding after registration.

### Generation API changes

Current files:

- `app/api/generate/route.ts`
- `app/api/generate/usage/route.ts`
- `components/GeneratePanel.tsx`
- `lib/types.ts`

Needed changes:

- `GET /api/generate/usage` should return current credit balance and model costs.
- `POST /api/generate` should:
  1. Authenticate user.
  2. Load profile/tier.
  3. Check feature permission.
  4. Determine model cost.
  5. Reserve or spend credits atomically.
  6. Call FAL.
  7. Save generation.
  8. Confirm spend or refund credits on failure.

### Credit safety

Do not rely on "read balance, then update balance" in application code for production. Two simultaneous requests can overspend.

Use a Postgres RPC function like:

```sql
create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
as $$
declare
  current_balance integer;
begin
  select credits into current_balance
  from public.user_credit_balances
  where user_id = p_user_id
  for update;

  if current_balance is null or current_balance < p_amount then
    return false;
  end if;

  update public.user_credit_balances
  set credits = credits - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    reason,
    metadata
  )
  values (
    p_user_id,
    -p_amount,
    current_balance - p_amount,
    p_reason,
    p_metadata
  );

  return true;
end;
$$;
```

## 9. Billing Plan

Recommended provider: Stripe.

### Required pieces

- Stripe customer id on profile.
- Checkout route for credit packs.
- Checkout route for subscription, later.
- Stripe webhook route.
- Webhook signature verification.
- Idempotency table to avoid processing the same event twice.
- Credit grant after successful payment.

### Tables

```sql
create table if not exists public.billing_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz default now(),
  payload jsonb
);
```

### Launch with credit packs first

Credit packs are easier than subscriptions:

- Simple purchase.
- Simple fulfillment.
- Less billing complexity.
- Lets you test willingness to pay.

Add subscriptions once you know usage patterns.

## 10. Product Pages Needed

### Public

- Landing page.
- Pricing page.
- Login/register page with public positioning.
- Terms of service.
- Privacy policy.
- AI usage policy.

### Authenticated

- Upgrade page.
- Credits/billing page.
- Onboarding page.
- Account page with plan and credits.
- Better empty states for free users.

### Admin, later

- User search.
- User tier/status editor.
- Credit adjustment tool.
- Generation cost dashboard.
- Content moderation dashboard.

## 11. Production Checklist

### Security

- Review all RLS policies.
- Ensure service role key is never exposed client-side.
- Keep FAL API key server-only.
- Add API rate limiting.
- Validate all request bodies.
- Add file upload size/type checks everywhere.
- Protect public profile fields from leaking private data.
- Add admin-only checks server-side.

### Reliability

- Add structured error logging.
- Add generation failure handling and credit refund logic.
- Add webhook idempotency.
- Add database backups.
- Add monitoring for API errors.
- Add monitoring for generation cost spikes.

### Cost control

- Track cost per model.
- Set daily spend alerts in FAL.
- Add per-user rate limits.
- Add per-plan model restrictions.
- Consider disabling expensive video models for free users.

### Legal/compliance

- Terms of service.
- Privacy policy.
- Refund policy.
- AI acceptable use policy.
- Copyright/IP language for generated outputs.
- Community/content moderation policy.

### UX

- Clear credit counter.
- Clear upgrade prompts.
- Clear failed generation messages.
- Clear distinction between included monthly credits and purchased credits.
- Onboarding that explains what THE ARCHIVE is.
- Public pages that explain the value before forcing login.

### Deployment

- Confirm all env vars in Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `FAL_API_KEY`
  - Stripe keys, once added
  - Webhook secret, once added
- Run `npm run lint`.
- Run `npm run build`.
- Test auth callback URLs in Supabase.
- Test email confirmation.
- Test password reset.
- Test production database policies.

## 12. Roadmap

### Phase 1 - Business foundation

Goal: make access tiers explicit.

- Define tier names and limits.
- Add `access_tier` and plan fields to `profiles`.
- Add plans table.
- Add credit balance and credit ledger.
- Seed default plans.
- Migrate existing active members into `community`.

### Phase 2 - Access refactor

Goal: support public, free, community, and pro users.

- Refactor middleware.
- Add `lib/access.ts`.
- Update RLS policies.
- Make public routes truly public.
- Add upgrade page.
- Update inactive page into a general access/upgrade page.

### Phase 3 - Credit-based generation

Goal: make generation production-ready.

- Replace monthly counters with credits.
- Add model cost map.
- Add atomic credit spend RPC.
- Add refund logic on failed generation.
- Update UI counter.
- Add clear free-user limits.

### Phase 4 - Monetization

Goal: sell credits.

- Add Stripe.
- Add checkout for credit packs.
- Add webhook.
- Add billing events table.
- Add credits page.
- Test payments in Stripe test mode.

### Phase 5 - Public launch polish

Goal: make the product understandable and trustworthy.

- Landing page.
- Pricing page.
- Public examples.
- Terms/privacy/AI policy.
- Better onboarding.
- Analytics.
- Production QA.

### Phase 6 - Pro plan

Goal: add recurring revenue after usage data exists.

- Add subscriptions.
- Add monthly credit grants.
- Add customer portal.
- Add plan management.
- Add cancellation/downgrade handling.

## 13. Immediate Next Sprint

Recommended first implementation sprint:

1. Add plan/access fields to `profiles`.
2. Add `plans`, `user_credit_balances`, and `credit_transactions`.
3. Create seed SQL for `free`, `community`, `pro`.
4. Migrate active members to `access_tier = 'community'`.
5. Create `lib/access.ts`.
6. Create `lib/credits.ts`.
7. Refactor `/api/generate/usage`.
8. Refactor `/api/generate` to spend credits.
9. Update `GeneratePanel` to show credits instead of monthly image/video limits.
10. Refactor middleware so public/free/community routes are distinct.

## 14. Strategic Recommendation

Do not launch THE ARCHIVE as a broad SaaS immediately.

Launch it as a controlled public beta:

- Keep community members as the premium insider group.
- Let outside users register and try with a small credit grant.
- Sell credit packs before subscriptions.
- Watch which features actually drive activation:
  - generation,
  - saved prompts,
  - moodboards,
  - workflows,
  - public profiles,
  - community inspiration.

The strongest business version of THE ARCHIVE is likely not "another AI image generator." It is a creative operating system where generation is one powerful feature inside a curated archive, workflow library, and private creative ecosystem.

