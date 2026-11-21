// Runs the migrations against a real Postgres (PGlite, Postgres compiled to
// WebAssembly) and checks the rules the schema is supposed to enforce.
// Usage: npm run db:check
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

const db = new PGlite()
let failures = 0

function ok(name) {
  console.log(`  ok    ${name}`)
}

function fail(name, detail) {
  failures++
  console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ''}`)
}

async function expectError(name, sql, pattern) {
  try {
    await db.exec(sql)
    fail(name, 'statement succeeded but should have been refused')
  } catch (e) {
    if (pattern.test(String(e.message))) ok(name)
    else fail(name, `refused, but for another reason: ${e.message}`)
  }
}

// Supabase provides auth.users. Stand in for it here.
await db.exec('create schema auth; create table auth.users (id uuid primary key);')

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    ok(`migration applies: ${file}`)
  } catch (e) {
    fail(`migration applies: ${file}`, e.message)
  }
}

// Every table has row-level security on, and none has a policy yet.
const tables = await db.query(
  `select c.relname, c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by 1`,
)
const open = tables.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)
if (tables.rows.length > 0 && open.length === 0) ok(`row-level security is on for all ${tables.rows.length} tables`)
else fail('row-level security is on for every table', `off for: ${open.join(', ') || 'no tables found'}`)

const policies = await db.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`)
if (policies.rows[0].n === 0) ok('no policies yet, so the publishable key reaches nothing')
else fail('no policies yet', `${policies.rows[0].n} found`)

// A small show, to exercise the constraints.
await db.exec(`
  insert into orgs (id, name) values ('00000000-0000-0000-0000-000000000001', 'Test org');
  insert into events (id, org_id, name, start_date, end_date)
    values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Test event', '2026-11-21', '2026-11-22');
  insert into meets (id, event_id, label, meet_date)
    values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Meet #5', '2026-11-21');
  insert into rule_sets (id, name, definition) values ('ihsa-reining', 'IHSA reining', '{}');
  insert into classes (id, meet_id, class_no, name, card_family, rule_set_id)
    values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '17', 'Open Reining', 'pattern', 'ihsa-reining');
  insert into sections (id, class_id) values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004');
  insert into entries (id, section_id, back_no, order_position)
    values ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005', '214', 1),
           ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000005', '187', 1.1);
  insert into seats (id, meet_id, seat_no) values ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000003', 1);
  insert into cards (id, entry_id, seat_id, family, computed_half, final_half)
    values ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000008', 'pattern', 141, 141);
  insert into card_events (id, card_id, seq, type, payload)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000009', 1, 'set_box', '{"box": 1, "half": 1}');
`)
ok('a meet, class, section, entries, card and event can be stored')

const points = await db.query(`select points_table from classes`)
if (JSON.stringify(points.rows[0].points_table) === '[7,5,4,3,2,1]') ok('points table defaults to 7, 5, 4, 3, 2, 1')
else fail('points table default', JSON.stringify(points.rows[0].points_table))

await expectError(
  'an overridden total without a note is refused',
  `update cards set final_half = 144 where id = '00000000-0000-0000-0000-000000000009'`,
  /override_needs_note/,
)

try {
  await db.exec(
    `update cards set final_half = 144, override_note = 'Judge set the score' where id = '00000000-0000-0000-0000-000000000009'`,
  )
  ok('an overridden total with a note is accepted')
} catch (e) {
  fail('an overridden total with a note is accepted', e.message)
}

await expectError(
  'a card event cannot be changed',
  `update card_events set type = 'x' where id = '00000000-0000-0000-0000-00000000000a'`,
  /append-only/,
)
await expectError(
  'a card event cannot be deleted',
  `delete from card_events where id = '00000000-0000-0000-0000-00000000000a'`,
  /append-only/,
)
await expectError(
  'two events cannot share a sequence number on one card',
  `insert into card_events (id, card_id, seq, type) values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000009', 1, 'set_box')`,
  /unique|duplicate/i,
)
await expectError(
  'a back number cannot appear twice in a section',
  `insert into entries (section_id, back_no) values ('00000000-0000-0000-0000-000000000005', '214')`,
  /unique|duplicate/i,
)

await db.exec(`
  insert into placings (section_id, seat_id, entry_id, place)
    values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000006', 1);
`)
await expectError(
  'two riders cannot share a place on a placings card',
  `insert into placings (section_id, seat_id, entry_id, place)
     values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000007', 1)`,
  /unique|duplicate/i,
)

console.log(failures === 0 ? '\nAll schema checks passed.' : `\n${failures} schema check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
