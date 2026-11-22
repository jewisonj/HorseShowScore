-- Horse Show Scorer: a coach starts on 0000 and chooses their own PIN. Safe to run more than once.
--
-- The owner said on 2026-11-22: the PINs made for coaches were random and
-- awkward to hand out. Every team's coach starts on the same PIN, 0000, and
-- chooses their own once they are in.
--
-- One PIN for every team cannot say which team a coach belongs to, so a coach
-- now names their team as well. The starting PIN opens one thing: the step
-- where the coach chooses their own. No rider is shown and no mark is set
-- until they have, and after that 0000 no longer works for that team. A chosen
-- PIN is kept as a salted hash, not as its digits.
--
-- A show admin turns a team's coach sign-on on or off, and puts a team back on
-- the starting PIN when its coach forgets theirs.

-- ---------------------------------------------------------------------------
-- 1. The teams. A team whose coach may sign on, and where its PIN stands: no
--    hash means the starting PIN.
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists coach_on boolean not null default false;
alter table public.teams add column if not exists pin_salt text;
alter table public.teams add column if not exists pin_hash text;
alter table public.teams add column if not exists pin_changed_at timestamptz;

-- Teams that were given a PIN keep their coach sign-on and start again on 0000.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teams' and column_name = 'pin') then
    update public.teams set coach_on = true where pin is not null;
    alter table public.teams drop constraint if exists teams_pin_once;
    alter table public.teams drop constraint if exists teams_pin;
    alter table public.teams drop column pin;
  end if;
end $$;

alter table public.teams drop constraint if exists teams_pin_whole;
alter table public.teams add constraint teams_pin_whole
  check ((pin_hash is null) = (pin_salt is null) and (pin_hash is null) = (pin_changed_at is null));

-- ---------------------------------------------------------------------------
-- 2. What a team and a PIN open. Wrong tries are counted the way they were:
--    ten in ten minutes from one address and that address is refused a while.
-- ---------------------------------------------------------------------------
drop function if exists public.coach_riders(text);
drop function if exists public.coach_set_mark(text, text, boolean, int);
drop function if exists private.find_team(text);

create or replace function private.pin_digest(p_salt text, p_pin text)
returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_salt || ':' || p_pin, 'UTF8')), 'hex')
$$;

-- 'ok' for the team's own PIN, 'change_pin' for the starting PIN of a team
-- whose coach has not chosen one yet, and nothing for anything else.
create or replace function private.coach_seat(p_team text, p_pin text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_source text := private.caller_source();
  v_tries int;
  v_team public.teams%rowtype;
  v_said text;
begin
  select count(*) into v_tries from private.pin_failures f
    where f.show_id = '(coach)' and f.source = v_source and f.at > now() - interval '10 minutes';
  if v_tries >= 10 then
    raise exception 'too_many_tries';
  end if;
  if coalesce(p_team, '') <> '' and coalesce(p_pin, '') <> '' then
    select * into v_team from public.teams t where t.team = p_team and t.coach_on;
    if found then
      if v_team.pin_hash is null then
        if p_pin = '0000' then
          v_said := 'change_pin';
        end if;
      elsif v_team.pin_hash = private.pin_digest(v_team.pin_salt, p_pin) then
        v_said := 'ok';
      end if;
    end if;
  end if;
  if v_said is null then
    insert into private.pin_failures (show_id, source) values ('(coach)', v_source);
    delete from private.pin_failures f where f.at < now() - interval '1 day';
  end if;
  return v_said;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- The teams whose coach may sign on. Names only: a coach picks theirs.
create or replace function public.coach_teams()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.team order by t.team), '[]'::jsonb) from public.teams t where t.coach_on
$$;

-- A coach's riders, with their marks. Nothing for a wrong PIN, and only the
-- word to choose a PIN for the starting one.
create or replace function public.coach_riders(p_team text, p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_said text := private.coach_seat(p_team, p_pin);
begin
  if v_said is null then
    return jsonb_build_object('ok', false);
  end if;
  if v_said <> 'ok' then
    return jsonb_build_object('ok', true, 'team', p_team, 'change_pin', true);
  end if;
  return jsonb_build_object(
    'ok', true,
    'team', p_team,
    'riders', coalesce((
      select jsonb_agg(jsonb_build_object('back_no', r.back_no, 'rider', r.rider, 'height_rider', r.height_rider, 'weight_group', r.weight_group) order by r.rider, r.back_no)
      from public.riders r where r.team = p_team
    ), '[]'::jsonb)
  );
end;
$$;

-- A coach sets the marks of one of their own riders.
create or replace function public.coach_set_mark(p_team text, p_pin text, p_back_no text, p_height boolean, p_group int)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_said text := private.coach_seat(p_team, p_pin);
begin
  if v_said is null then
    return 'wrong_pin';
  end if;
  if v_said <> 'ok' then
    return 'change_pin';
  end if;
  if p_group is null or p_group not between 1 and 3 then
    return 'bad_group';
  end if;
  update public.riders r
    set height_rider = coalesce(p_height, false), weight_group = p_group, updated_at = now()
    where r.back_no = p_back_no and r.team = p_team;
  if not found then
    return 'not_yours';
  end if;
  return 'ok';
end;
$$;

-- A coach chooses their own PIN: 4 to 8 digits, and not the starting one. It
-- takes the PIN they have now, which the first time is the starting PIN.
create or replace function public.coach_change_pin(p_team text, p_pin text, p_new_pin text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_said text := private.coach_seat(p_team, p_pin);
  v_salt text;
begin
  if v_said is null then
    return 'wrong_pin';
  end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4,8}$' or p_new_pin = '0000' then
    return 'bad_pin';
  end if;
  v_salt := gen_random_uuid()::text;
  update public.teams t
    set pin_salt = v_salt, pin_hash = private.pin_digest(v_salt, p_new_pin), pin_changed_at = now()
    where t.team = p_team;
  return 'ok';
end;
$$;

revoke all on function public.coach_teams() from public;
revoke all on function public.coach_riders(text, text) from public;
revoke all on function public.coach_set_mark(text, text, text, boolean, int) from public;
revoke all on function public.coach_change_pin(text, text, text) from public;
grant execute on function public.coach_teams() to anon, authenticated;
grant execute on function public.coach_riders(text, text) to anon, authenticated;
grant execute on function public.coach_set_mark(text, text, text, boolean, int) to anon, authenticated;
grant execute on function public.coach_change_pin(text, text, text) to anon, authenticated;
