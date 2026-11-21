-- Horse Show Scorer: first schema.
--
-- STATUS: DRAFT. Not applied to the Supabase project yet, and not used by the
-- Phase 0 prototype, which stores everything on the device.
-- It will change once the real IHSA cards and the legacy Google Sheet are seen.
--
-- Conventions
--   * Every score is a whole number of half points. 70½ is 141. No floats.
--   * Row-level security is ON for every table and there are NO policies yet,
--     so the publishable key can read and write nothing. Policies come with
--     the Phase 1 sync work.
--   * card_events is append-only. It is the audit trail.
--   * Rider height and weight are deliberately absent. See decision D-25.

-- ---------- Types ----------

create type card_family as enum ('placings', 'pattern', 'run_content');

-- How a ride is ranked. Not a point deduction.
create type run_mark as enum ('none', 'OP', 'ZERO', 'DQ', 'NO_SCORE', 'NON_ENTRY', 'SCRATCH');

create type member_role as enum ('admin', 'office');

create type card_status as enum ('open', 'submitted', 'review_hold', 'signed', 'verified', 'reopened');

create type section_status as enum ('open', 'verified', 'not_scored');

-- ---------- Organisations, events, meets ----------

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  association text,
  host text,
  start_date date not null,
  end_date date not null,
  -- Test events are for practice and video scoring. Never listed publicly.
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Staff accounts. Operators (scribes and judges) do not get accounts.
create table show_members (
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null,
  primary key (event_id, user_id)
);

-- A meet is one show: its own judge, patterns, results and team totals.
create table meets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  label text not null,
  meet_date date not null,
  start_time time,
  -- Shadow mode: another system is the official record.
  shadow_mode boolean not null default true,
  public_results boolean not null default false,
  -- IHSA cards are not public. Other shows can open them after verification.
  public_cards boolean not null default false,
  unique (event_id, label)
);

create table judges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null
);

-- ---------- Rules and patterns ----------

-- A rule set is data: scale, penalties, marks, points table, judge model.
create table rule_sets (
  id text primary key,
  name text not null,
  association text,
  edition text,
  definition jsonb not null,
  -- Release gate: a person checks it line by line against the rulebook.
  verified_by text,
  verified_at timestamptz,
  check ((verified_by is null) = (verified_at is null))
);

create table patterns (
  id uuid primary key default gen_random_uuid(),
  -- null org means a built-in pattern
  org_id uuid references orgs (id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null,
  version integer not null default 1,
  start_note text not null default '',
  finish_note text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, code, version)
);

-- The admin names the boxes. They are never inferred from printed numbering.
create table pattern_boxes (
  pattern_id uuid not null references patterns (id) on delete cascade,
  position integer not null check (position >= 1),
  label text not null,
  description text not null default '',
  tags text[] not null default '{}',
  primary key (pattern_id, position)
);

create table pattern_assets (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references patterns (id) on delete cascade,
  storage_path text not null,
  page integer
);

-- ---------- Classes, sections, people, horses ----------

create table classes (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  class_no text not null,
  name text not null,
  card_family card_family not null,
  rule_set_id text not null references rule_sets (id),
  -- One pattern can serve several classes.
  pattern_id uuid references patterns (id),
  -- Points for first, second, ... IHSA is 7, 5, 4, 3, 2, 1.
  points_table integer[] not null default '{7,5,4,3,2,1}',
  notes text not null default '',
  position integer not null default 0,
  unique (meet_id, class_no)
);

-- A class can be split into sections that are placed separately.
create table sections (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id) on delete cascade,
  label text not null default 'A',
  position integer not null default 1,
  -- not_scored: partial data is normal while running beside a legacy system.
  status section_status not null default 'open',
  unique (class_id, label)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null,
  unique (event_id, name)
);

create table riders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null,
  team_id uuid references teams (id) on delete set null
);

create table horses (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  name text not null,
  is_alternate boolean not null default false,
  notes text not null default '',
  unique (meet_id, name)
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections (id) on delete cascade,
  rider_id uuid references riders (id) on delete set null,
  back_no text not null,
  point_rider boolean not null default false,
  scratched boolean not null default false,
  -- Order of go. Numeric so late entries can sit at 1.1 or -1.
  order_position numeric,
  unique (section_id, back_no)
);

-- The horse draw is done by hand and typed in. A move to the alternate adds
-- a row and retires the old one, so the history stays.
create table horse_draws (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries (id) on delete cascade,
  horse_id uuid not null references horses (id),
  is_current boolean not null default true,
  replaced_reason text,
  created_at timestamptz not null default now()
);

create unique index horse_draws_one_current on horse_draws (entry_id) where is_current;

-- ---------- Seats ----------

-- One seat per judge per meet. Whoever holds the device joins with a PIN.
create table seats (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  seat_no integer not null check (seat_no >= 1),
  judge_id uuid references judges (id) on delete set null,
  pin_hash text,
  expires_at timestamptz,
  unique (meet_id, seat_no)
);

create table seat_sessions (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references seats (id) on delete cascade,
  auth_uid uuid,
  device_label text,
  started_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ---------- Scoring ----------

-- Card ids are made on the device so a card can exist before it syncs.
create table cards (
  id uuid primary key,
  entry_id uuid not null references entries (id) on delete cascade,
  seat_id uuid not null references seats (id),
  family card_family not null,
  status card_status not null default 'open',
  mark run_mark not null default 'none',
  -- Half points. computed is what the engine totals. final is what counts.
  computed_half integer,
  final_half integer,
  override_note text,
  -- A re-ride replaces the first ride. The first card stays, pointing at it.
  replaced_by uuid references cards (id),
  rules_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An overridden total must carry a note (decision D-09).
  constraint override_needs_note check (
    final_half is null
    or computed_half is null
    or final_half = computed_half
    or (override_note is not null and length(btrim(override_note)) > 0)
  )
);

create index cards_entry on cards (entry_id);

-- Every scoring action, exactly as it happened. Never updated, never deleted.
create table card_events (
  id uuid primary key,
  card_id uuid not null references cards (id) on delete restrict,
  seq integer not null check (seq >= 1),
  type text not null,
  payload jsonb not null default '{}',
  session_id uuid references seat_sessions (id),
  device_time timestamptz,
  server_time timestamptz not null default now(),
  unique (card_id, seq)
);

create function card_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'card_events is append-only';
end;
$$;

create trigger card_events_no_change
before update or delete on card_events
for each row execute function card_events_append_only();

-- The judge's order for a section. No ties on a placings card.
create table placings (
  section_id uuid not null references sections (id) on delete cascade,
  seat_id uuid not null references seats (id),
  entry_id uuid not null references entries (id) on delete cascade,
  place integer not null check (place >= 1),
  mark run_mark not null default 'none',
  primary key (section_id, seat_id, entry_id),
  unique (section_id, seat_id, place)
);

-- ---------- Imports ----------

create table imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  kind text not null check (kind in ('csv', 'google_sheet', 'photo', 'pattern_book')),
  source_name text,
  mapping jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------- Row-level security: on everywhere, closed by default ----------

alter table orgs enable row level security;
alter table events enable row level security;
alter table show_members enable row level security;
alter table meets enable row level security;
alter table judges enable row level security;
alter table rule_sets enable row level security;
alter table patterns enable row level security;
alter table pattern_boxes enable row level security;
alter table pattern_assets enable row level security;
alter table classes enable row level security;
alter table sections enable row level security;
alter table teams enable row level security;
alter table riders enable row level security;
alter table horses enable row level security;
alter table entries enable row level security;
alter table horse_draws enable row level security;
alter table seats enable row level security;
alter table seat_sessions enable row level security;
alter table cards enable row level security;
alter table card_events enable row level security;
alter table placings enable row level security;
alter table imports enable row level security;
