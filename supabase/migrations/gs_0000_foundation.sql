-- VC Game Studio's own Supabase project (vc-game-studio, ikzjxigttvdvguawvtyf):
-- the foundation the commerce tables (gs_0001) stand on. VC Game Studio and
-- VC Writer are separate products with separate projects; these are the
-- pieces that once came from VC Writer's project, made here the same way so
-- the site and app behave as before.
--
-- - profiles: one row per account, made by a trigger when someone signs up;
-- - the enums platform, license_status and release_channel;
-- - touch_updated_at(), the updated_at trigger function;
-- - email_events, the log of every transactional email sent;
-- - rate_limits and consume_rate_limit(), the per-address limiter.

create type public.platform as enum ('windows', 'macos');
create type public.license_status as enum ('active', 'suspended', 'revoked', 'expired');
create type public.release_channel as enum ('stable', 'beta', 'internal');

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Accounts.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

create policy "people read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "people update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- A profile for every new account (a sign-in link or a checkout made signed out).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Email follows the address: an account whose email changes keeps its profile in step.
create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.handle_user_email_change();

-- Transactional email, logged whatever the outcome (service role only).
create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  template text not null,
  provider_message_id text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_events_user_idx on public.email_events (user_id);

create trigger email_events_touch_updated_at before update on public.email_events
  for each row execute function public.touch_updated_at();

alter table public.email_events enable row level security;
-- No policies: service role only.

-- The per-address rate limiter (service role only).
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies: service role only.

create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning public.rate_limits.count into v_count;

  if v_count = 1 then
    delete from public.rate_limits where window_start < now() - make_interval(secs => p_window_seconds * 2);
  end if;

  return query
  select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    case
      when v_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer)
    end;
end;
$$;

-- Only the server (service role) may spend an allowance.
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
