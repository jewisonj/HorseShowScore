-- Horse Show Scorer: shows in the database.
--
-- What this gives:
--   * A show set up on a computer is published here, and every phone picks it
--     from the list. No show files to pass around.
--   * Anyone can read a published show: classes, draw, patterns. That is the
--     same information as the printed program.
--   * Only people listed in show_admins can add, change or remove a show.
--   * Scores are NOT stored here yet. They stay on each device.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Who may set up shows. Rows are added by hand, by the project owner, in the
-- SQL editor. There is no way to add yourself through the app.
-- ---------------------------------------------------------------------------
create table if not exists public.show_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);

alter table public.show_admins enable row level security;

-- True when the signed-in person may set up shows. Runs with the owner's rights
-- so it can look at show_admins, which nobody can read directly except their own row.
create or replace function public.is_show_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.show_admins a where a.user_id = (select auth.uid()));
$$;

drop policy if exists "people see their own admin row" on public.show_admins;
create policy "people see their own admin row" on public.show_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Shows. The whole show (days, classes, draw, patterns) is one document, the
-- same thing the app saves as a show file.
-- ---------------------------------------------------------------------------
create table if not exists public.shows (
  id text primary key,
  name text not null,
  host text not null default '',
  start_date date,
  end_date date,
  definition jsonb not null,
  published boolean not null default true,
  owner uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shows_id_shape check (id ~ '^[A-Za-z0-9_-]{3,64}$'),
  constraint shows_name_present check (length(btrim(name)) between 1 and 200),
  -- coalesce matters: a missing field gives null, and a check that comes out
  -- null lets the row in.
  constraint shows_definition_is_this_show check (
    jsonb_typeof(definition) = 'object'
    and coalesce(definition ->> 'format', '') = 'hss-show'
    and coalesce(definition ->> 'id', '') = id
  ),
  -- A show with a few hundred rides is about 50 KB. This stops anything absurd.
  constraint shows_definition_size check (octet_length(definition::text) < 2000000)
);

alter table public.shows enable row level security;

create or replace function public.shows_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- The owner and the creation time never change after the first save.
  new.owner := old.owner;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists shows_touch on public.shows;
create trigger shows_touch before update on public.shows
  for each row execute function public.shows_touch();

drop policy if exists "anyone reads published shows" on public.shows;
create policy "anyone reads published shows" on public.shows
  for select to anon, authenticated
  using (published or (select public.is_show_admin()));

drop policy if exists "show admins add shows" on public.shows;
create policy "show admins add shows" on public.shows
  for insert to authenticated
  with check ((select public.is_show_admin()) and owner = (select auth.uid()));

drop policy if exists "show admins change shows" on public.shows;
create policy "show admins change shows" on public.shows
  for update to authenticated
  using ((select public.is_show_admin()))
  with check ((select public.is_show_admin()));

drop policy if exists "show admins remove shows" on public.shows;
create policy "show admins remove shows" on public.shows
  for delete to authenticated
  using ((select public.is_show_admin()));

-- ---------------------------------------------------------------------------
-- What the app's key may touch. New Supabase projects expose nothing until it
-- is granted, so every grant is spelled out. Row-level security above still
-- decides which rows.
-- ---------------------------------------------------------------------------
revoke all on public.show_admins from anon, authenticated;
revoke all on public.shows from anon, authenticated;

grant select on public.shows to anon, authenticated;
grant insert, update, delete on public.shows to authenticated;
grant select on public.show_admins to authenticated;

revoke all on function public.is_show_admin() from public;
grant execute on function public.is_show_admin() to anon, authenticated;
revoke all on function public.shows_touch() from public, anon, authenticated;
