-- Horse Show Scorer: score cards the show office has released. Safe to run more than once.
--
-- The owner decided on 2026-11-21: after a class, or at the end of the show,
-- the show office releases the score cards, as it publishes placings. A
-- released card is public: every maneuver score, penalty, the total and the
-- judge's note for the rider. Until the office releases a class, none of that
-- leaves the office's view. Placings stay as they are: place, number, rider, horse.

create table if not exists public.class_cards (
  show_id text not null references public.shows (id) on delete cascade,
  class_key text not null,
  -- One entry per rider who rode: place, number, rider, horse, the card and the note.
  cards jsonb not null,
  published_at timestamptz not null default now(),
  primary key (show_id, class_key),
  constraint class_cards_class_key check (length(class_key) between 3 and 150),
  constraint class_cards_cards check (jsonb_typeof(cards) = 'array' and octet_length(cards::text) < 200000)
);

alter table public.class_cards enable row level security;

drop policy if exists "anyone reads released score cards" on public.class_cards;
create policy "anyone reads released score cards" on public.class_cards
  for select to anon, authenticated
  using (true);

-- Nothing is written to this table directly. Releasing and taking down go
-- through the two functions below, which check the office PIN or the admin's sign-in.
revoke all on public.class_cards from anon, authenticated;
grant select on public.class_cards to anon, authenticated;

create or replace function public.office_release_cards(p_show text, p_pin text, p_class_key text, p_cards jsonb)
returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_office(p_show, p_pin) then
    return 'wrong_pin';
  end if;
  insert into public.class_cards (show_id, class_key, cards, published_at)
  values (p_show, p_class_key, p_cards, now())
  on conflict (show_id, class_key) do update set cards = excluded.cards, published_at = now();
  return 'ok';
end;
$$;

create or replace function public.office_take_down_cards(p_show text, p_pin text, p_class_key text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_office(p_show, p_pin) then
    return 'wrong_pin';
  end if;
  delete from public.class_cards c where c.show_id = p_show and c.class_key = p_class_key;
  return 'ok';
end;
$$;

revoke all on function public.office_release_cards(text, text, text, jsonb) from public;
revoke all on function public.office_take_down_cards(text, text, text) from public;
grant execute on function public.office_release_cards(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.office_take_down_cards(text, text, text) to anon, authenticated;
