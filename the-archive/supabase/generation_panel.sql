-- Generate Panel MVP tables and policies.
-- Run this in the Supabase SQL Editor for the project.

create table if not exists public.user_generation_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  year_month text not null,
  image_count integer default 0,
  video_count integer default 0,
  unique(user_id, year_month)
);

create table if not exists public.generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  prompt text not null,
  model text not null,
  generation_type text not null check (generation_type in ('image', 'video')),
  result_url text,
  reference_image_url text,
  is_saved boolean default false
);

alter table public.user_generation_usage enable row level security;
alter table public.generations enable row level security;

drop policy if exists "users see own usage" on public.user_generation_usage;
create policy "users see own usage" on public.user_generation_usage
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users see own generations" on public.generations;
create policy "users see own generations" on public.generations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
