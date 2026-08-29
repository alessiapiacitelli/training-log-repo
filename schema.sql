-- =====================================================================
-- 12-Week Log — database schema
-- Run once in Supabase: Database > SQL Editor > New query > Run.
-- Safe to re-run.
--
-- Accounts live in auth.users. Register goes through register_account()
-- so nothing is sent by the Auth mailer. Passwords are hashed; they are
-- never stored on these public tables.
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

-- ---------- username / password accounts ----------
-- Creates a confirmed Auth user so Register never hits /signup and
-- never queues an email. The client then signs in with the password.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.register_account(p_username text, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_username text := lower(trim(p_username));
  v_email text;
  v_hash text;
  v_has_provider_id boolean;
begin
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username: 3–24 letters, numbers, or underscore.';
  end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  v_email := v_username || '.traininglog@gmail.com';
  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    v_email,
    v_hash,
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('username', v_username),
    now(),
    now(),
    '', '', '', ''
  );

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_id::text,
      v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(), now(), now()
    );
  else
    insert into auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_id,
      v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(), now(), now()
    );
  end if;
exception
  when unique_violation then
    raise exception 'That username is taken. Sign in instead.';
end;
$fn$;

revoke all on function public.register_account(text, text) from public;
grant execute on function public.register_account(text, text) to anon, authenticated;

-- ---------- verify before you deploy ----------
-- Both rows must come back with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('entries','profile');
