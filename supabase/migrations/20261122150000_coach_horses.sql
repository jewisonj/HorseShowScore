-- Horse Show Scorer: a coach sees which horses their own school brings. Safe to run more than once.
--
-- The owner asked on 2026-11-22: some schools besides the host bring horses,
-- and a coach should see their own in the draw, so they know which classes a
-- horse of theirs has to be ready for even when no rider of theirs is in it.
--
-- Who provides a horse is in the horses list, which only show admins read.
-- This gives a signed-on coach the names of the horses their own team
-- provides, and nobody else's. A school is written a little differently from
-- tab to tab of the show sheet ("University of X - Y" and "University of X Y"),
-- so the two names are compared by their letters and digits alone.

create or replace function public.coach_riders(p_team text, p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_said text := private.coach_seat(p_team, p_pin);
  v_school text := regexp_replace(lower(coalesce(p_team, '')), '[^a-z0-9]+', '', 'g');
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
    ), '[]'::jsonb),
    'horses', coalesce((
      select jsonb_agg(h.name order by h.name)
      from public.horses h
      where v_school <> '' and regexp_replace(lower(h.provider), '[^a-z0-9]+', '', 'g') = v_school
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.coach_riders(text, text) from public;
grant execute on function public.coach_riders(text, text) to anon, authenticated;
