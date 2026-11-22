-- Horse Show Scorer: a horse's limits can differ from class to class. Safe to run more than once.
--
-- The owner said on 2026-11-22 that height and weight restrictions are set per
-- class: the same horse may carry less in reining than in a beginner class.
-- The horses list keeps a horse's usual limits. This column holds the classes
-- where they are different, by IHSA class number:
--   {"17": {"takes_height": false, "max_group": 2}}
-- Sections of one class share an entry.

alter table public.horses add column if not exists by_class jsonb not null default '{}'::jsonb;

alter table public.horses drop constraint if exists horses_by_class;
alter table public.horses add constraint horses_by_class
  check (jsonb_typeof(by_class) = 'object' and octet_length(by_class::text) < 4000);
