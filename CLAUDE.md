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
- A re-ride never erases a ride (`startReride` in `src/store.ts`). The ride so far moves into the run's `previous` list and stops counting; the rider gets a clear card, the re-ride horse, and goes to the end of the class. Reading the draw again must not put the first horse back.
- Rider height and weight are personal data (decision D-25). The app never holds a height or a weight. It holds two marks per rider: height rider yes or no, and a weight group of 1, 2 or 3.
- Those marks live in the riders list on the server (`public.riders`, owner's decision 2026-11-22, because they carry over from show to show). Only show admins read the list, and a coach reads and marks the riders of their own team. They are never in a show, a published show, the public pages, an export, the repo or its test data. Where the app has no server they stay in the draw book on the setup computer (`src/setup/drawBook.ts`).
- The horse draw (`#/s/<show id>/draw`, `src/setup/horseDraw.ts`) works from those marks and from what each horse carries: whether it is height restricted (a height rider cannot draw it; unmarked by default), and the heaviest weight group. On screen the box is "Height restricted"; the stored field is still `takesHeight` / `takes_height`, its opposite. Limits are set per class (owner, 2026-11-22): a horse has its usual limits, and a class can have its own, filed under the IHSA class number so the sections of a class share them (`by_class` on the server, `byClass` and `limitsIn` in `src/setup/drawBook.ts`). The draw always uses a horse's limits in the class being drawn. A horse's limits live in the horses list on the server (`public.horses`, owner's decision 2026-11-22, `#/horses`, show admins only), keyed by the horse's name and who provides it, so they are there for the next show. The draw book on the setup computer keeps which horses a show has and the horses set for each class, and a copy of the limits for when the server cannot be reached. Only the result goes in the show: each rider's horse and the class's alternates.
- A show sheet sets its horses before the riders draw: a horse beside each draw place on its draw tab, a horse listed twice when it goes twice, then the alternates. The draw page can read those (`readDrawTab`) and draw the riders onto the places (`drawPlaces`), so the sheet's own list is kept. The draw goes back to the sheet only by a person pasting: one column per class, one line per draw place, with the cell to paste at (`src/setup/drawExport.ts`), or the CSV. The app never writes to the sheet.
- A rider is their back number. When a sheet is read into the riders list and a back number has a different name, that rider's marks start again (`mergeRoster` in `src/cloud/roster.ts`).
- The draw is random. A rider draws from the horses they fit (owner's rule, 2026-11-21: the horse is available for the class, carries the rider's weight group in that class, and is not height restricted there if the rider is a height rider). No horse goes twice in a class that works the rail. Balance comes from which horses are set for a class, never from tilting the odds.

## Shows

- A show is one self-contained file (`ShowFile`): days, classes, draw and patterns. Meet ids and pattern ids are unique across shows, so a class is found from its meet id and class id alone.
- The sample shows ship in `src/data/`: one show per day, because IHSA runs each day as its own show and each show has its own workbook. One sheet, one show. Shows made in setup live in the device's storage and move between devices as show files until sync is built.
- One show per id, in this order: the copy being worked on here, then the published show, then the sample. A show admin turns a sample into the real show by changing its setup and publishing it. The days keep their ids when a sheet is read again (`keepMeetIds`), because scores are filed under the day's id.
- The show workbook is read only, in the browser, from an Excel file: a download, or a copy the server fetches from the sheet's link (`supabase/functions/fetch-workbook`, one GET of Google's export address for a link-shared sheet). Never write to anyone's Google Sheet. `src/setup/workbook.ts` says exactly which cells are relied on.
- A sheet's link is remembered on the setup computer only (`src/setup/sheetLink.ts`). Never put it in a show: published shows are public and the link opens the whole workbook. The draw page fills in its own show's link. The riders page fills in the link used last and offers each show's.
- Tests build their own small workbook with made-up names (`src/setup/testWorkbook.ts`). Do not commit a real show workbook.

## The server

- Supabase holds published shows (`public.shows`, one show file per row), the list of show admins, the scores judging devices send (`class_scores`) and published placings (`class_results`).
- Sign-on is by role (owner, 2026-11-21). **Judge or scribe**, **show office** and **steward** sign on to one show with a PIN the show admin set (`show_seats`, `src/cloud/seat.ts`). **Admin** signs in with an account and can do everything. Each judge has their own PIN, so two judges' scores are told apart. A show admin sets the number of judges and the PINs on `#/s/<show id>/seats`.
- A steward does one thing for now (owner, 2026-11-22): ask the judge for a re-ride for a rider (`#/s/<show id>/steward`, `reride_asks`, `src/cloud/rerides.ts`). The judge approves, with the horse, or denies, on the class list; a judge can also call a re-ride with nobody asking. An ask names the class and the back number, never a score. Devices signed on to the show look for asks every 15 seconds while a screen that shows them is open, and stop the moment the server says the PIN is wrong, because every wrong try counts toward the lockout.
- The server checks the PIN every time it is used, in the functions `seat_for`, `send_class_scores`, `office_scores`, `office_publish`, `office_unpublish`, `office_release_cards`, `office_take_down_cards`, `steward_ask_reride`, `reride_asks_for` and `judge_decide_reride`. They run with the owner's rights on purpose: they are the only way a device without an account reaches those tables, so Supabase's advisor lists them. Ten wrong PINs in ten minutes from one address locks that address out for a while.
- **Coach** (owner, 2026-11-22) signs on with a PIN the show admin made for their team on `#/riders`, not tied to any show (`public.teams`, `src/cloud/roster.ts`, `#/coach`). A coach sees their own team's riders and sets each one's two marks, through `coach_riders` and `coach_set_mark`, which check the PIN every time and count wrong tries apart from the show PINs. Coach PINs are 6 to 8 digits. Teams and schools are in the server's private tables only: never in a published show and never in this repo.
- The role gates in `src/App.tsx` are for clarity. What stops a stranger is the server: no score is accepted without a judge's PIN, and nothing is published without the office PIN or an admin's sign-in. A person can still score on their own device without signing on if they get past the screens; those scores go nowhere.
- Scores go one way: a signed-on judge's device sends each class of its show as it is scored (`src/cloud/scores.ts`), in the background, a new row each time, with the judge's seat and whether the judge has marked the class finished. Only the show office and show admins read them. The judge's typed name goes with it, for them only. Devices do not read scores back.
- Placings become public only when the show office or a show admin publishes a class (`#/s/<show id>/results`). Published placings carry place, back number, rider and horse, all the way down. The database refuses a score, penalty or maneuver mark in them.
- A published show is readable by anyone. It may hold only classes, the four draw fields, each class's alternate horses and patterns. Never add judges, schools, coaches, scores, or rider height, weight, height-rider marks or weight groups to it.
- Judges' names are not part of a show. The owner said on 2026-11-21 to remove them or let judges enter them. Setup does not ask for one, the workbook's judge column is not read, publishing strips them, and the database refuses a show that names one. A judge types a name on the day screen; it stays in that device's state and its results file.
- Pictures of pattern book pages are published with the show. The owner decided this on 2026-11-21: the associations make their patterns public. Setup draws the page in the browser (`src/setup/pdfPages.ts`, pdf.js, loaded only there) and stores a JPEG in the public `pattern-pages` bucket; a pattern's `page_image` holds the path. Only paths the app makes are turned into addresses (`pageImageUrl`). The pictures go to the server only: the rule below about not committing pattern diagrams to this repo still stands.
- `is_show_admin()` runs as the caller and is not callable without signing in. Keep it that way: Supabase's advisor flags owner-rights functions in `public`.
- Where the app has a server, creating and changing shows is offered only to signed-in show admins. The first screen for everyone else is the sign-on screen. Opening a show file is on the admin's first screen.
- Only people in `show_admins` change shows. Rows are added by the owner in the SQL editor, never from the app.
- New tables need row-level security, policies and explicit grants in the migration, and a check in `supabase/tests/check-migration.mjs` for each kind of caller.
- The app talks to the server only through `CloudBackend` (`src/cloud/backend.ts`). Tests use `makeFakeBackend` and never touch the network.
- Scoring never waits on the server. A failed read leaves the device with what it had.
- The pattern book reader is `supabase/functions/read-pattern-book`. Its logic is in `handler.ts` (web-standard APIs only, tested from `src/cloud/reader.test.ts`). Check the Anthropic docs before changing the request: forced tool use is refused by the current models, so it uses `output_config.format`.

## The public side

- `#/public` and `#/public/<show id>` are for riders, coaches and spectators (`src/ui/PublicScreens.tsx`). Read only: classes in running order, the draw and the patterns with their pictures.
- They show exactly what is published on the server. Never a sample, never a copy being worked on in setup, and nothing from this device's own scores.
- Placings show under a class once the show office or a show admin has published them. Placings never carry a score.
- Score cards are a separate release (owner, 2026-11-21): during a class or after the show, the office releases a class's score cards with its own button. A released card is public: each maneuver's score, penalties, the total and the judge's note for the rider (`class_cards`, `src/ui/PublicCard.tsx`). Until then none of that leaves the office's view.
- The live server can be reached from the development sandbox with the publishable key in `.env`: reads, and checking that unsigned writes are refused. Test against it instead of assuming.

## This repo is public

Do not commit any of these unless the owner says so:

- Association pattern text or diagrams. The test data carries pattern names, box counts, short maneuver codes and a few words per box in our own words. The owner asked for those on 2026-11-21.
- People other than riders: judges and coaches. Riders' schools too.
- Rider names **are** in the test data. The owner said on 2026-11-21 that they are public information. The draw carries draw order, back number, rider and horse.
- Scores or score sheets from a real show. Cards become public only when a show's office releases them in the app; they are still never committed here.
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
