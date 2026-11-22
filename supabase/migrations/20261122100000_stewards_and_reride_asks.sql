-- Horse Show Scorer: stewards, and their requests for a re-ride. Safe to run more than once.
--
-- A steward signs on to one show with a PIN the show admin set, like a judge
-- or the show office. For now a steward does one thing: ask the judge for a
-- re-ride for a rider. A judge approves or denies it. A judge can also call a
-- re-ride with nobody asking; that happens on the judge's device and never
-- comes here.
--
-- Nobody reaches the table directly. A device without an account gets to it
-- only through the functions below, which check the PIN every time.

-- ---------------------------------------------------------------------------
-- 1. A third kind of seat.
-- ---------------------------------------------------------------------------
alter table public.show_seats drop constraint if exists show_seats_role;
alter table public.show_seats add constraint show_seats_role check (role in ('judge', 'office', 'steward'));

-- ---------------------------------------------------------------------------
-- 2. The requests. One row per ask: which class, which back number, why, and
--    what the judge said. No rider name, no score.
-- ---------------------------------------------------------------------------
create table if not exists public.reride_asks (
  id uuid primary key default gen_random_uuid(),
  show_id text not null references public.shows (id) on delete cascade,
  class_key text not null,
  back_no text not null,
  reason text not null default '',
  asked_by text not null default 'steward',
  asked_seat int,
  status text not null default 'asked',
  decided_seat int,
  asked_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint reride_asks_class_key check (length(class_key) between 3 and 150),
  constraint reride_asks_back_no check (back_no ~ '^[A-Za-z0-9]{1,8}$'),
  constraint reride_asks_reason check (length(reason) <= 200),
  constraint reride_asks_asked_by check (asked_by in ('steward', 'admin')),
  constraint reride_asks_status check (status in ('asked', 'approved', 'denied'))
);
create index if not exists reride_asks_show on public.reride_asks (show_id, asked_at desc);

alter table public.reride_asks enable row level security;
drop policy if exists "show admins see re-ride asks" on public.reride_asks;
create policy "show admins see re-ride asks" on public.reride_asks for select to authenticated using ((select public.is_show_admin()));
revoke all on public.reride_asks from anon, authenticated;
grant select on public.reride_asks to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who is asking: the seat a PIN opens, or 'admin' for a signed-in show
--    admin who gives no PIN. Nothing for anyone else.
-- ---------------------------------------------------------------------------
create or replace function private.seat_role(p_show text, p_pin text)
returns table (role text, seat_no int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(p_pin, '') = '' then
    if exists (select 1 from public.show_admins a where a.user_id = (select auth.uid())) then
      return query select 'admin'::text, null::int;
    end if;
    return;
  end if;
  return query select f.role, f.seat_no from private.find_seat(p_show, p_pin) f;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- A steward, or a show admin, asks for a re-ride.
create or replace function public.steward_ask_reride(p_show text, p_pin text, p_class_key text, p_back_no text, p_reason text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text;
  v_seat int;
begin
  if not exists (select 1 from public.shows s where s.id = p_show and s.published) then
    return 'not_published';
  end if;
  select r.role, r.seat_no into v_role, v_seat from private.seat_role(p_show, p_pin) r;
  if v_role is null or v_role not in ('steward', 'admin') then
    return 'wrong_pin';
  end if;
  if exists (select 1 from public.reride_asks a where a.show_id = p_show and a.class_key = p_class_key and a.back_no = p_back_no and a.status = 'asked') then
    return 'already_asked';
  end if;
  -- A show does not need hundreds of these in a day. A stuck device cannot fill the table.
  if (select count(*) from public.reride_asks a where a.show_id = p_show and a.asked_at > now() - interval '1 day') >= 300 then
    return 'too_many';
  end if;
  insert into public.reride_asks (show_id, class_key, back_no, reason, asked_by, asked_seat)
  values (p_show, p_class_key, p_back_no, left(coalesce(p_reason, ''), 200), v_role, v_seat);
  return 'ok';
end;
$$;

-- Anyone signed on to the show, with any of its PINs, or a show admin: the
-- asks of the last two days, oldest first. A wrong PIN is told so, so the
-- device stops asking.
create or replace function public.reride_asks_for(p_show text, p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text;
begin
  select r.role into v_role from private.seat_role(p_show, p_pin) r;
  if v_role is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'asks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'class_key', a.class_key, 'back_no', a.back_no, 'reason', a.reason,
        'status', a.status, 'asked_at', a.asked_at, 'decided_at', a.decided_at
      ) order by a.asked_at)
      from public.reride_asks a
      where a.show_id = p_show and a.asked_at > now() - interval '2 days'
    ), '[]'::jsonb)
  );
end;
$$;

-- A judge, or a show admin, approves or denies an ask. Once decided it stays decided.
create or replace function public.judge_decide_reride(p_show text, p_pin text, p_id uuid, p_approve boolean)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text;
  v_seat int;
begin
  select r.role, r.seat_no into v_role, v_seat from private.seat_role(p_show, p_pin) r;
  if v_role is null or v_role not in ('judge', 'admin') then
    return 'wrong_pin';
  end if;
  update public.reride_asks a
    set status = case when coalesce(p_approve, false) then 'approved' else 'denied' end, decided_seat = v_seat, decided_at = now()
    where a.id = p_id and a.show_id = p_show and a.status = 'asked';
  if found then
    return 'ok';
  end if;
  if exists (select 1 from public.reride_asks a where a.id = p_id and a.show_id = p_show) then
    return 'already_decided';
  end if;
  return 'not_found';
end;
$$;

revoke all on function public.steward_ask_reride(text, text, text, text, text) from public;
revoke all on function public.reride_asks_for(text, text) from public;
revoke all on function public.judge_decide_reride(text, text, uuid, boolean) from public;
grant execute on function public.steward_ask_reride(text, text, text, text, text) to anon, authenticated;
grant execute on function public.reride_asks_for(text, text) to anon, authenticated;
grant execute on function public.judge_decide_reride(text, text, uuid, boolean) to anon, authenticated;
