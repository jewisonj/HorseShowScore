# Horse Show Scorer

A free judging and scoring tool for small horse shows: IHSA meets, ARHA and local ranch horse shows, local reining and cow horse shows. Whoever is writing for the judge, or the judge alone, fills in the card on a phone or tablet. The app totals it and works out placings and points.

## Where this stands

**Phase 0 prototype.** It exists to answer one question: can someone keep up with a judge using these screens?

- The **score card** follows the IHSA score sheets: a penalty strip over a score box for each maneuver, then rail work (horsemanship) and F&E, which are added to the score. Reining and ranch riding score −1½ to +1½. Horsemanship scores −3 to +3.
- Each box is named above it: a short code on a phone (`Rr S`, `4 LS`, `S&B`), the words from the sheet on a tablet.
- Tapping a penalty value **asks which penalty**, from the list for that value, with the ones that fit the maneuver first. A penalty can be **circled**: the horse's fault, shown on the card, not counted.
- **Rail work** for a whole horsemanship class is scored on one screen, first, before the patterns.
- The **placings card** takes the judge's order for horsemanship classes and gives IHSA points.
- The first screen is a **show picker**. A show set up on a computer is **published to the server** and every phone lists it. A show file still works where there is no signal.
- **Show setup** reads the Google Sheets show workbook (downloaded as an Excel file) for the classes, running order and draw. Patterns are picked from other shows, typed in, or **read from the pattern book PDF** by a reader on the server.
- A class's placings can be **copied for the show workbook** and pasted into its Placings column.
- It comes with two sample shows, one per day, from a real IHSA weekend (November 21–22, 2026). Each day is its own show, as IHSA runs them. Saturday has the show's 12 classes in running order and the draw: back numbers, riders and horses. Sunday has the class list.
- **Scores are saved on the device only.** Shows come from the server; scores do not go to it yet. Only the people who set up shows sign in.
- Every screen says **"Unofficial test"**. The show's own system is the official record.
- **Penalty values are placeholders.** The IHSA sheets do not list them, so reining follows NRHA and ranch riding follows the AQHA sheet. Each card says so.

What is not built yet: scores on the server (they still leave a device by CSV or backup), seats and PINs, tie-breakers, teams and high point, office screens, writing results into the Google Sheet without a paste.

## Try it

```
npm install
npm run dev
```

Then open the address it prints. On a phone on the same Wi-Fi, use the Network address.

A quick walk through:

1. Pick a meet, then a class. Saturday's riders are already there in draw order. Elsewhere, type back numbers with spaces between them (`214 187 302`) and press **Add**.
2. Tap a rider to open the card. Tap a score for each maneuver. The card moves to the next box by itself, and to F&E after the last one.
3. A penalty goes into whichever box is outlined. Tap an earlier box first if the judge called it late. Pick the penalty from the list, or **Just the number**.
4. Tap a penalty under "Penalties here" to change it, circle it or remove it.
5. In horsemanship, tap the **Rail** box to give the rail work score.
6. **Save run** takes you back to the class, where results and IHSA points appear.
7. In a horsemanship class, press **Place the class** and tap riders in the judge's order. They are listed best score first.
8. From the first screen, **Export results as CSV**.

### What to watch for when testing

- Can you keep up with a fast run without looking down for long?
- Do penalties land in the right box? The judge may call one before or after the maneuver score.
- Is anything too small to hit while watching the ring?
- Twelve-box patterns wrap to three rows. Is the box being scored always in view?
- Does the total match the judge's paper card? If not, which number differs?
- Are the boxes the same as on the judge's sheet? The sheet may group maneuvers differently from the pattern book.
- One-handed on a phone, as a judge with no scribe.

## Set up a show

Do this on a computer.

1. On the first screen, **Create a show**.
2. If the show is kept in the Google Sheets show workbook: in Google Sheets, File, Download, Microsoft Excel. Then **Choose the workbook**. It fills in the days, the classes in running order and the draw. The file is read in the browser. Nothing is uploaded and the sheet is never changed.
3. Or add days and classes by hand.
4. Pick a pattern for each class. Patterns from other shows on the device are offered. **New pattern** opens an editor: one row per box on the judge's score sheet, with a short code and a few words. A list can be pasted in.
5. **Save the show**. Then, on the show's screen, **Download the show file**.
6. Send the show file to each phone or tablet. There, **Open a show file** on the first screen.

### Send placings back to the workbook

On a class with results, **Copy placings for the sheet**. In the workbook, open that class's tab, click the first Placings cell (J6) and paste as values only. Each line is one draw place: a placing, `DQ`, or blank.

## Put it on Vercel

1. In Vercel, **Add New → Project** and import this GitHub repo.
2. Leave the settings as detected: framework **Vite**, build command `npm run build`, output `dist`.
3. Deploy. Every push to `main` redeploys.

No environment variables are needed for the prototype. Once it is open on a phone, add it to the home screen. It then works with no signal, and the phone is less likely to clear its saved data.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local development server |
| `npm test` | Scoring engine, results and card screen tests |
| `npm run build` | Type-check and production build into `dist` |
| `npm run db:check` | Runs the database migration against a real Postgres and checks its rules |

## How it is put together

```
src/engine/     Scoring engine. Pure TypeScript, no UI, no storage.
src/rules/      Rule sets as data: scales, penalty values, marks.
src/data/       The sample show, and the store of shows added on the device.
src/setup/      Show setup: the Excel reader, the show workbook import, drafts.
src/seed.ts     Puts each show's draw on the device the first time.
src/store.ts    Saves to the device on every tap.
src/results.ts  Placings, points and CSV from what is stored.
src/ui/         The screens.
supabase/       Draft database migration and its checks.
```

Rules that hold across the code:

- **Scores are whole numbers of half points.** 70½ is stored as 141. No floating point in scoring. Fractions are for display only.
- **Rules are data.** Scales, penalty values and marks live in rule sets, never in screen code.
- **Every tap is saved before the screen confirms it.**
- **The engine has a test for every worked example in the requirements.** Change a rule and its test together.

## The server (Supabase)

What the server does today:

- **Published shows.** A show admin sets a show up, signs in and chooses Publish. Every phone lists it the next time it is online, and keeps it for when there is no signal. Anyone with the app can read a published show: classes, draw and patterns. Judges' names are never published: the database refuses a show that names one. Each judge types a name on the day screen of the device they score on, and it goes in that device's results file.
- **Setup is for signed-in show admins.** A phone that is not signed in can pick a show, score it and open a show file. It is not offered Create a show.
- **The workbook from its link.** In setup, paste the Google Sheets link and the server fetches an Excel copy (function `fetch-workbook`). The sheet must be shared so anyone with the link can view. It is only read.
- **The pattern book's page with each pattern.** When patterns are added from the book, setup also saves a picture of each one's page. Judges see it under the written maneuvers on the class screen, and a phone keeps it for when there is no signal. A page can be changed or added by hand in the pattern editor.
- **Pattern book reader.** In setup, a signed-in show admin hands over the pattern book as a PDF. An Edge Function sends it to Claude and answers with each pattern as boxes with short codes. A person ticks what to keep and checks it against the book.
- **Scores are not on the server yet.** They stay on each device. `supabase/drafts/full-schema-draft.sql` is a sketch for that step, not a migration.

### Set it up, once

1. **Tables.** In the Supabase dashboard open the SQL editor and run each file in `supabase/migrations/`, in name order. Each is safe to run twice, but always finish with the last one.
2. **Your account.** Authentication, Users, Add user: your email and a password. Then in the SQL editor, with your email in place of the example:
   ```sql
   insert into public.show_admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com';
   ```
   Add other people who set up shows the same way. Nobody can add themselves from the app.
3. **No sign-ups.** Authentication, Sign In / Providers, at the top of the page: turn off "Allow new users to sign up". An account that is not in `show_admins` can do nothing more than a phone that is not signed in, but there is no reason to let strangers make accounts.
4. **The Anthropic key.** Edge Functions, Secrets: add `ANTHROPIC_API_KEY`. It lives only there. It never goes in `.env`, the repo or the app.
5. **The reader.** From this folder on a computer:
   ```
   npx supabase login
   npx supabase functions deploy read-pattern-book --project-ref vczrsrkjmbuxzzmmfypr
   npx supabase functions deploy fetch-workbook --project-ref vczrsrkjmbuxzzmmfypr
   ```
   `supabase/config.toml` turns off the platform's own sign-in check for these functions, because each one asks the database whether the caller is a show admin before it does anything.

Optional function secrets: `PATTERN_READER_MODEL` (default `claude-sonnet-5-5`) and `PATTERN_READER_EFFORT` (default `medium`).

### What has and has not been tested

`npm run db:check` runs the migrations on a real Postgres in memory and checks who can read, add, change and remove shows: a phone with only the app's key, a signed-in person off the list, and a show admin. On 2026-11-21 the same rules were checked on the live project, inside a transaction that was rolled back, and Supabase's security advisor showed no warnings about the tables or functions.

The app's side and the reader's logic are tested against stand-ins. **Publishing from the app and reading a pattern book have not yet been run against the live project or the live Anthropic API**, so the first publish and the first pattern book are the real test.

## Requirements

The requirement, decision-log and scoring-reference documents live in the Claude Project "Horse Show Scorer", not in this repo.

## What is and is not in this public repo

- **Patterns:** names, box counts, short maneuver codes and a few words per box, written in our own words. No pattern text copied from an association and no diagrams. NRHA states its patterns may not be reproduced without approval, and other associations' patterns raise the same question.
- **Penalty lists:** short descriptions in our own words of what each penalty value is for.
- **The draw:** draw order, back number, rider name and horse. The repo owner confirmed rider names are public information.
- **Not here:** riders' schools, coaches, judges, and any scores from a real show.
