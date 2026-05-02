-- OnMe schema
-- Run in Supabase SQL editor on a fresh project.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,
  profile_pic text,
  body_photos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create type post_category as enum ('watch','ring','necklace','earring','bracelet','outfit');
create type vote_kind as enum ('cop','drop');

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  category post_category not null,
  source_image_url text not null,
  product_name text not null,
  product_url text,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

create table if not exists public.try_ons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  result_image_url text,
  vote vote_kind,
  created_at timestamptz not null default now()
);

create index if not exists try_ons_user_idx on public.try_ons (user_id, created_at desc);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  vote vote_kind not null,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

-- Storage buckets (run via dashboard or supabase CLI):
-- body-photos     (private)
-- tryon-results   (public read)
-- post-images     (public read)

-- RLS
alter table public.users    enable row level security;
alter table public.posts    enable row level security;
alter table public.try_ons  enable row level security;
alter table public.votes    enable row level security;

create policy "users readable by all"        on public.users    for select using (true);
create policy "users insert self"            on public.users    for insert with check (auth.uid() = id);
create policy "users update self"            on public.users    for update using (auth.uid() = id);

create policy "posts readable by all"        on public.posts    for select using (true);
create policy "posts insert by author"       on public.posts    for insert with check (auth.uid() = user_id);
create policy "posts update by author"       on public.posts    for update using (auth.uid() = user_id);
create policy "posts delete by author"       on public.posts    for delete using (auth.uid() = user_id);

create policy "tryons readable by owner"     on public.try_ons  for select using (auth.uid() = user_id);
create policy "tryons insert by owner"       on public.try_ons  for insert with check (auth.uid() = user_id);
create policy "tryons update by owner"       on public.try_ons  for update using (auth.uid() = user_id);

create policy "votes readable by all"        on public.votes    for select using (true);
create policy "votes insert by self"         on public.votes    for insert with check (auth.uid() = user_id);
create policy "votes update by self"         on public.votes    for update using (auth.uid() = user_id);
create policy "votes delete by self"         on public.votes    for delete using (auth.uid() = user_id);

-- Aggregated counts for the feed
create or replace view public.post_vote_counts as
  select
    p.id as post_id,
    coalesce(sum(case when v.vote = 'cop'  then 1 else 0 end), 0)::int as cops,
    coalesce(sum(case when v.vote = 'drop' then 1 else 0 end), 0)::int as drops
  from public.posts p
  left join public.votes v on v.post_id = p.id
  group by p.id;
