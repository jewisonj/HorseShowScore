-- Horse Show Scorer: two tightenings. Safe to run more than once.
--
-- 1. Judges' names never go on the server. A published show can be read by
--    anyone, and the owner decided on 2026-11-21 that judges stay out of it.
--    Each judge types a name on the device they score on.
-- 2. is_show_admin() no longer runs with the owner's rights, and a caller who
--    is not signed in can no longer call it.

-- ---------------------------------------------------------------------------
-- 1. No judges in a show.
-- ---------------------------------------------------------------------------
-- Empty the judges list of every day in any show already stored.
update public.shows s
set definition = jsonb_set(
  s.definition,
  '{meets}',
  (
    select coalesce(jsonb_agg(t.meet || '{"judges": []}'::jsonb order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(s.definition -> 'meets') with ordinality as t(meet, ord)
  )
)
where jsonb_path_exists(s.definition, '$.meets[*].judges[*]');

alter table public.shows drop constraint if exists shows_no_judge_names;
alter table public.shows add constraint shows_no_judge_names
  check (not jsonb_path_exists(definition, '$.meets[*].judges[*]'));

-- ---------------------------------------------------------------------------
-- 2. The admin check runs as the caller.
--    A signed-in person may read their own row of show_admins, and that is all
--    the check needs. Nobody else's row is visible to it.
-- ---------------------------------------------------------------------------
create or replace function public.is_show_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.show_admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function public.is_show_admin() from public, anon;
grant execute on function public.is_show_admin() to authenticated;

-- Reading shows: anyone reads the published ones. The admin check is only run
-- for people who are signed in.
drop policy if exists "anyone reads published shows" on public.shows;
create policy "anyone reads published shows" on public.shows
  for select to anon, authenticated
  using (published);

drop policy if exists "show admins read every show" on public.shows;
create policy "show admins read every show" on public.shows
  for select to authenticated
  using ((select public.is_show_admin()));
