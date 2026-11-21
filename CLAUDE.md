# Horse Show Scorer: notes for working in this repo

Read `README.md` first. The requirements, decision log and scoring references live in the Claude Project "Horse Show Scorer" (docs 01 to 05). Attach that Project, or ask for them, before making design decisions.

## Ground rules

- Scores are integers of half points (70½ = 141). Never use floats for scoring. Use `formatHalf` to display.
- Rules are data. Scales, penalty values and their lists, extra boxes (rail work, F&E), marks and points tables go in `src/rules/` (later the `rule_sets` table), not in components.
- A card's score is 70 + maneuvers + extras − penalties. A circled penalty stays on the card and is not counted.
- The scoring engine in `src/engine/` stays pure: no React, no storage, no network.
- Every worked example in the requirements (doc 02, section 6) has a test in `src/engine/engine.test.ts`. If a rule changes, change the doc and the test together.
- Nothing about a rule set is verified until a person checks it against the rulebook. Keep `verified: false` and the on-screen note until then.
- Save to storage before updating the screen. Never make scoring wait on the network.
- An operator must never be able to see another judge's card.
- Rider height and weight are personal data. Do not add them without the admin-only handling in decision D-25.

## This repo is public

Do not commit any of these unless the owner says so:

- Association pattern text or diagrams. The test data carries pattern names, box counts, short maneuver codes and a few words per box in our own words. The owner asked for those on 2026-11-21.
- Real people's names: riders, judges, coaches. Their schools too. The draw in the test data is back numbers and horses only.
- Scores or score sheets from a real show. IHSA cards are not public.
- The planning documents from the Claude Project.

`src/results.test.ts` has a test that fails if a judge or an extra field turns up in the test data.

## Secrets

`.env` may hold only the Supabase project URL and the publishable key. Never commit `sb_secret_...`, a service role key or a database password.

## Checks before committing

```
npm run typecheck
npm test
npm run build
npm run db:check   # when a migration changes
```

## Design

Phone first, usable one-handed while watching the ring. Light theme only. Touch targets at least 52 px tall. See the notes at the top of `src/styles.css` before changing the look.

## Writing on screen

Plain words, sentence case. Fractions as ½, never .5. Say what a button does ("Save run"). Every screen in shadow mode says it is unofficial.
