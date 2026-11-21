-- Horse Show Scorer: sign-on by role. Safe to run more than once.
--
-- The owner decided on 2026-11-21:
--   * Judge or scribe: enters scores and marks a class finished. Signs on with a PIN.
--   * Show office: publishes placings. Signs on with a PIN.
--   * Admin: does everything, and signs in with an email and password.
--   * A show admin sets how many judges a show has and each PIN. Two judges
--     have two PINs, so their scores are told apart.
--
-- A PIN is checked here, on the server, every time it is used. Without a
-- judge's PIN no score is accepted. Without the office PIN, or an admin's
-- sign-in, nothing is published.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The seats of a show and their PINs. Only show admins can see or set them.
--    A PIN is 4 to 8 digits and opens exactly one seat of its show.
-- ---------------------------------------------------------------------------
create table if not exists public.show_seats (
  show_id text not null references public.shows (id) on delete cascade,
  role text not null,
  seat_no int not null,
  pin text not null,
  primary key (show_id, role, seat_no),
  constraint show_seats_role check (role in ('judge', 'office')),
  constraint show_seats_seat_no check (seat_no between 1 and 12),
  constraint show_seats_pin check (pin ~ '^[0-9]{4,8}$'),
  constraint show_seats_pin_once_per_show unique (show_id, pin)
);

alter table public.show_seats enable row level security;

drop policy if exists "show admins see seats" on public.show_seats;
create policy "show admins see seats" on public.show_seats for select to authenticated using ((select public.is_show_admin()));
drop policy if exists "show admins add seats" on public.show_seats;
create policy "show admins add seats" on public.show_seats for insert to authenticated with check ((select public.is_show_admin()));
drop policy if exists "show admins change seats" on public.show_seats;
create policy "show admins change seats" on public.show_seats for update to authenticated using ((select public.is_show_admin())) with check ((select public.is_show_admin()));
drop policy if exists "show admins remove seats" on public.show_seats;
create policy "show admins remove seats" on public.show_seats for delete to authenticated using ((select public.is_show_admin()));

revoke all on public.show_seats from anon, authenticated;
grant select, insert, update, delete on public.show_seats to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Checking a PIN. Wrong tries are counted for each show and each network
--    address, and after ten in ten minutes that address is refused for a while,
--    so a PIN cannot be found by trying them all.
-- ---------------------------------------------------------------------------
create table if not exists private.pin_failures (
  show_id text not null,
  source text not null,
  at timestamptz not null default now()
);
create index if not exists pin_failures_recent on private.pin_failures (show_id, source, at);

create or replace function private.caller_source()
returns text language sql stable set search_path = '' as $$
  select coalesce(
    nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    'unknown'
  );
$$;

create or replace function private.find_seat(p_show text, p_pin text)
returns table (role text, seat_no int)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_source text := private.caller_source();
  v_tries int;
begin
  select count(*) into v_tries from private.pin_failures f
    where f.show_id = p_show and f.source = v_source and f.at > now() - interval '10 minutes';
  if v_tries >= 10 then
    raise exception 'too_many_tries';
  end if;
  return query select s.role, s.seat_no from public.show_seats s where s.show_id = p_show and s.pin = p_pin;
  if not found then
    insert into private.pin_failures (show_id, source) values (p_show, v_source);
    delete from private.pin_failures f where f.at < now() - interval '1 day';
  end if;
end;
$$;

-- True for the office PIN of the show, or for a signed-in show admin who gives no PIN.
create or replace function private.is_office(p_show text, p_pin text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(p_pin, '') = '' then
    return exists (select 1 from public.show_admins a where a.user_id = (select auth.uid()));
  end if;
  return exists (select 1 from private.find_seat(p_show, p_pin) f where f.role = 'office');
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Sign-on: which seat does this PIN open? Nothing comes back for a wrong PIN.
create or replace function public.seat_for(p_show text, p_pin text)
returns table (role text, seat_no int)
language sql volatile security definer set search_path = '' as $$
  select f.role, f.seat_no from private.find_seat(p_show, coalesce(p_pin, '')) f;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sending scores now needs a judge's PIN, or a signed-in show admin.
--    The row records which judge's seat sent it and whether the judge has
--    marked the class finished.
-- ---------------------------------------------------------------------------
alter table public.class_scores add column if not exists seat_no int;
alter table public.class_scores add column if not exists finished boolean not null default false;

drop policy if exists "judging devices send scores for published shows" on public.class_scores;
revoke insert on public.class_scores from anon, authenticated;

create or replace function public.send_class_scores(
  p_show text, p_pin text, p_class_key text, p_device text, p_judge text, p_results jsonb, p_finished boolean
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_seat int;
begin
  if not exists (select 1 from public.shows s where s.id = p_show and s.published) then
    return 'not_published';
  end if;
  if coalesce(p_pin, '') = '' then
    -- A signed-in show admin scoring on their own device.
    if not exists (select 1 from public.show_admins a where a.user_id = (select auth.uid())) then
      return 'wrong_pin';
    end if;
  else
    select f.seat_no into v_seat from private.find_seat(p_show, p_pin) f where f.role = 'judge';
    if v_seat is null then
      return 'wrong_pin';
    end if;
  end if;
  insert into public.class_scores (show_id, class_key, device, judge, results, seat_no, finished)
  values (p_show, p_class_key, p_device, coalesce(p_judge, ''), p_results, v_seat, coalesce(p_finished, false));
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The show office: read what the judges sent, publish a class's placings,
--    take them down. Needs the office PIN, or a signed-in show admin.
-- ---------------------------------------------------------------------------
alter table public.class_results alter column published_by drop not null;

create or replace function public.office_scores(p_show text, p_pin text)
returns table (class_key text, device text, judge text, seat_no int, finished boolean, results jsonb, sent_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_office(p_show, p_pin) then
    return;
  end if;
  return query
    select c.class_key, c.device, c.judge, c.seat_no, c.finished, c.results, c.sent_at
    from public.class_scores c where c.show_id = p_show order by c.sent_at desc limit 1000;
end;
$$;

create or replace function public.office_publish(p_show text, p_pin text, p_class_key text, p_placings jsonb)
returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_office(p_show, p_pin) then
    return 'wrong_pin';
  end if;
  insert into public.class_results (show_id, class_key, placings, published_at, published_by)
  values (p_show, p_class_key, p_placings, now(), (select auth.uid()))
  on conflict (show_id, class_key) do update
    set placings = excluded.placings, published_at = now(), published_by = excluded.published_by;
  return 'ok';
end;
$$;

create or replace function public.office_unpublish(p_show text, p_pin text, p_class_key text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_office(p_show, p_pin) then
    return 'wrong_pin';
  end if;
  delete from public.class_results r where r.show_id = p_show and r.class_key = p_class_key;
  return 'ok';
end;
$$;

revoke all on function public.seat_for(text, text) from public;
revoke all on function public.send_class_scores(text, text, text, text, text, jsonb, boolean) from public;
revoke all on function public.office_scores(text, text) from public;
revoke all on function public.office_publish(text, text, text, jsonb) from public;
revoke all on function public.office_unpublish(text, text, text) from public;
grant execute on function public.seat_for(text, text) to anon, authenticated;
grant execute on function public.send_class_scores(text, text, text, text, text, jsonb, boolean) to anon, authenticated;
grant execute on function public.office_scores(text, text) to anon, authenticated;
grant execute on function public.office_publish(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.office_unpublish(text, text, text) to anon, authenticated;
