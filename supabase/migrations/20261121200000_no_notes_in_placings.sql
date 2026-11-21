-- Horse Show Scorer: a judge's note for a rider never goes public.
-- Safe to run more than once.
--
-- A judge can write a short note on a rider's card. It goes to the show office
-- with the scores. Published placings must not carry it, any more than a score.

alter table public.class_results drop constraint if exists class_results_no_scores;
alter table public.class_results add constraint class_results_no_scores check (
  not jsonb_path_exists(placings, '$[*].score')
  and not jsonb_path_exists(placings, '$[*].boxes')
  and not jsonb_path_exists(placings, '$[*].penalties')
  and not jsonb_path_exists(placings, '$[*].extras')
  and not jsonb_path_exists(placings, '$[*].note')
  and not jsonb_path_exists(placings, '$[*].mark')
);
