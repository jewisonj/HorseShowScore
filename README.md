# Horse Show Scorer

A free judging and scoring tool for small horse shows: IHSA meets, ARHA and local ranch horse shows, local reining and cow horse shows. Whoever is writing for the judge, or the judge alone, fills in the card on a phone or tablet. The app totals it and works out placings and points.

## Where this stands

**Phase 0 prototype.** It exists to answer one question: can someone keep up with a judge using these screens?

- The **score card** follows the IHSA score sheets: a penalty strip over a score box for each maneuver, then rail work (horsemanship) and F&E, which are added to the score. Reining and ranch riding score −1½ to +1½. Horsemanship scores −3 to +3.
- Each box is named above it: a short code on a phone (`Rr S`, `4 LS`, `S&B`), the words from the sheet on a tablet.
- Tapping a penalty value **asks which penalty**, from the list for that value, with the ones that fit the maneuver first. A penalty can be **circled**: the horse's fault, shown on the card, not counted.
- The **placings card** takes the judge's order for horsemanship classes and gives IHSA points.
- It is loaded with two real IHSA meets (November 21–22, 2026). Saturday has the show's 12 classes in running order and the draw: back numbers and horses. Sunday has the class list.
- Everything is saved **on the device only**. There is no sign-in and no server sync yet.
- Every screen says **"Unofficial test"**. The show's own system is the official record.
- **Penalty values are placeholders.** The IHSA sheets do not list them, so reining follows NRHA and ranch riding follows the AQHA sheet. Each card says so.

What is not built yet: sync to Supabase, seats and PINs, importing entries from a file or sheet, rider names, tie-breakers, teams and high point, office screens, entering your own patterns.

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
src/data/       Test data: meets, classes, the draw, patterns.
src/seed.ts     Puts the draw on the device the first time.
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

## Supabase

The project is at `https://vczrsrkjmbuxzzmmfypr.supabase.co`. The prototype does not talk to it yet.

`.env` holds the project URL and the publishable key. Those two are public by design and are shipped to every browser. **Never commit a secret key (`sb_secret_...`), the service role key or the database password.**

`supabase/migrations/` holds a **draft** first schema. It has not been applied. Row-level security is on for every table with no policies, so the publishable key can reach nothing until policies are written. To apply it later, use the Supabase CLI (`supabase db push`) or paste it into the SQL editor.

## Requirements

The requirement, decision-log and scoring-reference documents live in the Claude Project "Horse Show Scorer", not in this repo.

## What is and is not in this public repo

- **Patterns:** names, box counts, short maneuver codes and a few words per box, written in our own words. No pattern text copied from an association and no diagrams. NRHA states its patterns may not be reproduced without approval, and other associations' patterns raise the same question.
- **Penalty lists:** short descriptions in our own words of what each penalty value is for.
- **The draw:** back numbers and horse names only.
- **No people:** no rider names, schools, coaches or judges. No scores from a real show.
