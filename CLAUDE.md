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

## Shows

- A show is one self-contained file (`ShowFile`): days, classes, draw and patterns. Meet ids and pattern ids are unique across shows, so a class is found from its meet id and class id alone.
- The sample show ships in `src/data/`. Shows made in setup live in the device's storage and move between devices as show files until sync is built.
- The show workbook is read only, in the browser, from an Excel file: a download, or a copy the server fetches from the sheet's link (`supabase/functions/fetch-workbook`, one GET of Google's export address for a link-shared sheet). Never write to anyone's Google Sheet. `src/setup/workbook.ts` says exactly which cells are relied on.
- A sheet's link is remembered on the setup computer only (`src/setup/sheetLink.ts`). Never put it in a show: published shows are public and the link opens the whole workbook.
- Tests build their own small workbook with made-up names (`src/setup/testWorkbook.ts`). Do not commit a real show workbook.

## The server

- Supabase holds published shows (`public.shows`, one show file per row) and the list of show admins. Scores are not on the server yet.
- A published show is readable by anyone. It may hold only classes, the four draw fields and patterns. Never add judges, schools, coaches, scores, or rider height and weight to it.
- Judges' names are not part of a show. The owner said on 2026-11-21 to remove them or let judges enter them. Setup does not ask for one, the workbook's judge column is not read, publishing strips them, and the database refuses a show that names one. A judge types a name on the day screen; it stays in that device's state and its results file.
- `is_show_admin()` runs as the caller and is not callable without signing in. Keep it that way: Supabase's advisor flags owner-rights functions in `public`.
- Where the app has a server, creating and changing shows is offered only to signed-in show admins (the first screen, setup, the show screen). That is for clarity, not safety: the database is what refuses everyone else. Opening a show file stays open to all, for arenas with no signal.
- Only people in `show_admins` change shows. Rows are added by the owner in the SQL editor, never from the app.
- New tables need row-level security, policies and explicit grants in the migration, and a check in `supabase/tests/check-migration.mjs` for each kind of caller.
- The app talks to the server only through `CloudBackend` (`src/cloud/backend.ts`). Tests use `makeFakeBackend` and never touch the network.
- Scoring never waits on the server. A failed read leaves the device with what it had.
- The pattern book reader is `supabase/functions/read-pattern-book`. Its logic is in `handler.ts` (web-standard APIs only, tested from `src/cloud/reader.test.ts`). Check the Anthropic docs before changing the request: forced tool use is refused by the current models, so it uses `output_config.format`.

## This repo is public

Do not commit any of these unless the owner says so:

- Association pattern text or diagrams. The test data carries pattern names, box counts, short maneuver codes and a few words per box in our own words. The owner asked for those on 2026-11-21.
- People other than riders: judges and coaches. Riders' schools too.
- Rider names **are** in the test data. The owner said on 2026-11-21 that they are public information. The draw carries draw order, back number, rider and horse.
- Scores or score sheets from a real show. IHSA cards are not public.
- The planning documents from the Claude Project.

`src/results.test.ts` has a test that fails if a judge, or any field beyond those four, turns up in the test data.

## Secrets

`.env` may hold only the Supabase project URL and the publishable key. Never commit `sb_secret_...`, a service role key or a database password. The Anthropic key is a Supabase function secret (`ANTHROPIC_API_KEY`) and nowhere else: not in `.env`, not in any `VITE_` variable, not in the repo.

## Where changes go

The owner said on 2026-11-21: push straight to `main` on this project until he says otherwise. Vercel deploys `main`, so run the checks below first. No pull request is needed.

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
