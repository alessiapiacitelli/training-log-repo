-- =====================================================================
-- 12-Week Log — database schema
-- Run once in Supabase: Database > SQL Editor > New query > Run.
-- Safe to re-run.
-- =====================================================================

-- ---------- tables ----------

create table if not exists public.entries (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.entries is 'One row per person per day: session log and body metrics.';

create table if not exists public.profile (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  start_date date,
  best       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.profile is 'Programme start date and personal records.';

create index if not exists entries_user_day_idx on public.entries (user_id, day desc);

-- ---------- row level security ----------
-- This is the step that matters. The anon key is public and ships in
-- config.js; these policies are the only thing keeping your rows private.

alter table public.entries enable row level security;
alter table public.profile enable row level security;

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own profile" on public.profile;
create policy "own profile" on public.profile
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- keep updated_at honest ----------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();

drop trigger if exists profile_touch on public.profile;
create trigger profile_touch before update on public.profile
  for each row execute function public.touch_updated_at();

-- ---------- verify before you deploy ----------
-- Both rows must come back with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('entries','profile');
