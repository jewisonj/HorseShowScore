-- Horse Show Scorer: the riders list and coaches. Safe to run more than once.
--
-- The horse draw works from two marks per rider: whether they are a height
-- rider, and a weight group of 1, 2 or 3. The owner decided on 2026-11-22 to
-- keep those on the server, because they carry over from show to show. They
-- are a yes or no and a group, never a height or a weight.
--
-- Who can see them: show admins, and a coach for the riders of their own team.
-- Nobody else, and never the public. A coach signs on with a PIN the show
-- admin set for the team. A rider is their back number.

-- ---------------------------------------------------------------------------
-- 1. The riders.
-- ---------------------------------------------------------------------------
create table if not exists public.riders (
  back_no text primary key,
  rider text not null default '',
  team text not null default '',
  height_rider boolean not null default false,
  weight_group int not null default 1,
  updated_at timestamptz not null default now(),
  constraint riders_back_no check (back_no ~ '^[A-Za-z0-9]{1,8}$'),
  constraint riders_rider check (length(rider) <= 120),
  constraint riders_team check (length(team) <= 120),
  constraint riders_weight_group check (weight_group between 1 and 3)
);
create index if not exists riders_team on public.riders (team);

alter table public.riders enable row level security;
drop policy if exists "show admins see riders" on public.riders;
create policy "show admins see riders" on public.riders for select to authenticated using ((select public.is_show_admin()));
drop policy if exists "show admins add riders" on public.riders;
create policy "show admins add riders" on public.riders for insert to authenticated with check ((select public.is_show_admin()));
drop policy if exists "show admins change riders" on public.riders;
create policy "show admins change riders" on public.riders for update to authenticated using ((select public.is_show_admin())) with check ((select public.is_show_admin()));
drop policy if exists "show admins remove riders" on public.riders;
create policy "show admins remove riders" on public.riders for delete to authenticated using ((select public.is_show_admin()));
revoke all on public.riders from anon, authenticated;
grant select, insert, update, delete on public.riders to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The teams and each team's coach PIN. A PIN is 6 to 8 digits and opens
--    exactly one team. A team with no PIN has no coach sign-on.
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  team text primary key,
  pin text,
  constraint teams_team check (length(btrim(team)) between 1 and 120),
  constraint teams_pin check (pin is null or pin ~ '^[0-9]{6,8}$'),
  constraint teams_pin_once unique (pin)
);

alter table public.teams enable row level security;
drop policy if exists "show admins see teams" on public.teams;
create policy "show admins see teams" on public.teams for select to authenticated using ((select public.is_show_admin()));
drop policy if exists "show admins add teams" on public.teams;
create policy "show admins add teams" on public.teams for insert to authenticated with check ((select public.is_show_admin()));
drop policy if exists "show admins change teams" on public.teams;
create policy "show admins change teams" on public.teams for update to authenticated using ((select public.is_show_admin())) with check ((select public.is_show_admin()));
drop policy if exists "show admins remove teams" on public.teams;
create policy "show admins remove teams" on public.teams for delete to authenticated using ((select public.is_show_admin()));
revoke all on public.teams from anon, authenticated;
grant select, insert, update, delete on public.teams to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A coach's PIN. Wrong tries are counted the way the show PINs are: ten in
--    ten minutes from one address and that address is refused for a while.
-- ---------------------------------------------------------------------------
create or replace function private.find_team(p_pin text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_source text := private.caller_source();
  v_tries int;
  v_team text;
begin
  select count(*) into v_tries from private.pin_failures f
    where f.show_id = '(coach)' and f.source = v_source and f.at > now() - interval '10 minutes';
  if v_tries >= 10 then
    raise exception 'too_many_tries';
  end if;
  if coalesce(p_pin, '') <> '' then
    select t.team into v_team from public.teams t where t.pin = p_pin;
  end if;
  if v_team is null then
    insert into private.pin_failures (show_id, source) values ('(coach)', v_source);
    delete from private.pin_failures f where f.at < now() - interval '1 day';
  end if;
  return v_team;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- A coach's team and its riders, with their marks. Nothing for a wrong PIN.
create or replace function public.coach_riders(p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team text := private.find_team(p_pin);
begin
  if v_team is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'team', v_team,
    'riders', coalesce((
      select jsonb_agg(jsonb_build_object('back_no', r.back_no, 'rider', r.rider, 'height_rider', r.height_rider, 'weight_group', r.weight_group) order by r.rider, r.back_no)
      from public.riders r where r.team = v_team
    ), '[]'::jsonb)
  );
end;
$$;

-- A coach sets the marks of one of their own riders.
create or replace function public.coach_set_mark(p_pin text, p_back_no text, p_height boolean, p_group int)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team text := private.find_team(p_pin);
begin
  if v_team is null then
    return 'wrong_pin';
  end if;
  if p_group is null or p_group not between 1 and 3 then
    return 'bad_group';
  end if;
  update public.riders r
    set height_rider = coalesce(p_height, false), weight_group = p_group, updated_at = now()
    where r.back_no = p_back_no and r.team = v_team;
  if not found then
    return 'not_yours';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.coach_riders(text) from public;
revoke all on function public.coach_set_mark(text, text, boolean, int) from public;
grant execute on function public.coach_riders(text) to anon, authenticated;
grant execute on function public.coach_set_mark(text, text, boolean, int) to anon, authenticated;
