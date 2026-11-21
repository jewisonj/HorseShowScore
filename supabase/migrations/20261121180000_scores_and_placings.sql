-- Horse Show Scorer: scores sent by judging devices, and published placings.
-- Safe to run more than once.
--
-- The owner decided on 2026-11-21:
--   * A judging device sends its scores for a class as they are entered.
--   * A show admin, on a page of their own, publishes a class's placings.
--   * The public sees placings all the way down. It never sees a score or a card.

-- ---------------------------------------------------------------------------
-- 1. What judging devices send. Private: only show admins can read it.
--    Each send is a new row, so nothing a judge sent is ever overwritten.
--    Scoring needs no account, so anyone with the app can add a row for a
--    published show. Nobody but a show admin can read one, and nothing here is
--    public until an admin publishes placings from it.
-- ---------------------------------------------------------------------------
create table if not exists public.class_scores (
  id bigint generated always as identity primary key,
  show_id text not null references public.shows (id) on delete cascade,
  -- "<day id>:<class id>", the same key a device files its scores under.
  class_key text not null,
  -- A random id made on the judging device. It tells one device's sends from another's.
  device text not null,
  -- The name the judge typed on that device. Seen by show admins only.
  judge text not null default '',
  -- The class as that device has it: one entry per rider, with place and score.
  results jsonb not null,
  sent_at timestamptz not null default now(),
  constraint class_scores_class_key check (length(class_key) between 3 and 150),
  constraint class_scores_device check (device ~ '^[A-Za-z0-9-]{16,64}$'),
  constraint class_scores_judge check (length(judge) <= 80),
  constraint class_scores_results check (jsonb_typeof(results) = 'array' and octet_length(results::text) < 100000)
);

create index if not exists class_scores_latest on public.class_scores (show_id, class_key, device, sent_at desc);

alter table public.class_scores enable row level security;

drop policy if exists "judging devices send scores for published shows" on public.class_scores;
create policy "judging devices send scores for published shows" on public.class_scores
  for insert to anon, authenticated
  with check (exists (select 1 from public.shows s where s.id = show_id and s.published));

drop policy if exists "show admins read sent scores" on public.class_scores;
create policy "show admins read sent scores" on public.class_scores
  for select to authenticated
  using ((select public.is_show_admin()));

drop policy if exists "show admins remove sent scores" on public.class_scores;
create policy "show admins remove sent scores" on public.class_scores
  for delete to authenticated
  using ((select public.is_show_admin()));

revoke all on public.class_scores from anon, authenticated;
grant insert on public.class_scores to anon, authenticated;
grant select, delete on public.class_scores to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Published placings. Public to read. Only show admins publish.
-- ---------------------------------------------------------------------------
create table if not exists public.class_results (
  show_id text not null references public.shows (id) on delete cascade,
  class_key text not null,
  -- One entry per rider: place, back number, rider, horse. Nothing else.
  placings jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid not null default auth.uid() references auth.users (id),
  primary key (show_id, class_key),
  constraint class_results_class_key check (length(class_key) between 3 and 150),
  constraint class_results_placings check (jsonb_typeof(placings) = 'array' and octet_length(placings::text) < 100000),
  -- Placings only. A score, a penalty or a maneuver mark never goes out.
  constraint class_results_no_scores check (
    not jsonb_path_exists(placings, '$[*].score')
    and not jsonb_path_exists(placings, '$[*].boxes')
    and not jsonb_path_exists(placings, '$[*].penalties')
    and not jsonb_path_exists(placings, '$[*].extras')
  )
);

alter table public.class_results enable row level security;

drop policy if exists "anyone reads published placings" on public.class_results;
create policy "anyone reads published placings" on public.class_results
  for select to anon, authenticated
  using (true);

drop policy if exists "show admins publish placings" on public.class_results;
create policy "show admins publish placings" on public.class_results
  for insert to authenticated
  with check ((select public.is_show_admin()) and published_by = (select auth.uid()));

drop policy if exists "show admins change placings" on public.class_results;
create policy "show admins change placings" on public.class_results
  for update to authenticated
  using ((select public.is_show_admin()))
  with check ((select public.is_show_admin()));

drop policy if exists "show admins take placings down" on public.class_results;
create policy "show admins take placings down" on public.class_results
  for delete to authenticated
  using ((select public.is_show_admin()));

revoke all on public.class_results from anon, authenticated;
grant select on public.class_results to anon, authenticated;
grant insert, update, delete on public.class_results to authenticated;
