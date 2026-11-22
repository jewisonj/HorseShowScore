// Runs the migrations against a real Postgres (PGlite, Postgres compiled to
// WebAssembly) and checks who can do what, as the app's key and as a signed-in
// person. Usage: npm run db:check
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')
const db = new PGlite()
let failures = 0
const ok = (name) => console.log(`  ok    ${name}`)
const fail = (name, detail) => {
  failures++
  console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ''}`)
}

const ADMIN = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

/** Run SQL as a visitor with only the app's key (anon), or as a signed-in person. */
async function as(who, sql) {
  const role = who === 'anon' ? 'anon' : 'authenticated'
  await db.exec(`select set_config('request.jwt.claim.sub', '${who === 'anon' ? '' : who}', false); set role ${role};`)
  try {
    return await db.query(sql)
  } finally {
    await db.exec('reset role;')
  }
}

async function allowed(name, who, sql, check) {
  try {
    const res = await as(who, sql)
    if (!check || check(res)) ok(name)
    else fail(name, `unexpected result: ${JSON.stringify(res.rows).slice(0, 200)} affected=${res.affectedRows}`)
  } catch (e) {
    fail(name, e.message)
  }
}

async function refused(name, who, sql, pattern) {
  try {
    const res = await as(who, sql)
    // An update or delete that row-level security hides simply touches nothing.
    if ((res.affectedRows ?? 0) === 0 && res.rows.length === 0 && !/^\s*insert/i.test(sql)) ok(name)
    else fail(name, 'statement went through but should have been refused')
  } catch (e) {
    if (pattern.test(String(e.message))) ok(name)
    else fail(name, `refused, but for another reason: ${e.message}`)
  }
}

// What Supabase provides: the auth schema, the API roles and auth.uid().
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase Storage keeps its files as rows here, with row-level security on.
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
  alter table storage.objects enable row level security;
  insert into storage.buckets (id, name) values ('something-else', 'something-else');
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.com'), ('${OTHER}', 'other@example.com');
`)

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const file of files) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    ok(`migration applies: ${file}`)
  } catch (e) {
    fail(`migration applies: ${file}`, e.message)
  }
}
for (const file of files) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    ok(`migration can be run a second time: ${file}`)
  } catch (e) {
    fail(`migration can be run a second time: ${file}`, e.message)
  }
}

const tables = await db.query(
  `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by 1`,
)
const open = tables.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)
if (tables.rows.length > 0 && open.length === 0) ok(`row-level security is on for all ${tables.rows.length} tables`)
else fail('row-level security is on for every table', `off for: ${open.join(', ') || 'no tables found'}`)

// The project owner lists one person as a show admin, by hand.
await db.exec(`insert into public.show_admins (user_id, note) values ('${ADMIN}', 'owner');`)

const show = (id, name = 'Spring show') =>
  `'${id}', '${name}', '${JSON.stringify({ format: 'hss-show', version: 1, id, name, host: '', association: 'IHSA', meets: [], patterns: [] })}'::jsonb`

console.log('\n  A show admin')
await allowed('can publish a show', ADMIN, `insert into public.shows (id, name, definition) values (${show('s-abc123')})`)
await allowed('can save a show that is not published yet', ADMIN, `insert into public.shows (id, name, definition, published) values (${show('s-draft1', 'Draft')}, false)`)
await allowed('can change a show', ADMIN, `update public.shows set name = 'Spring show, revised' where id = 's-abc123' returning name`, (r) => r.rows.length === 1)
await allowed('sees unpublished shows too', ADMIN, `select id from public.shows order by id`, (r) => r.rows.length === 2)
await refused('cannot save a show whose file belongs to another show', ADMIN, `insert into public.shows (id, name, definition) values ('s-wrong1', 'X', '{"format":"hss-show","id":"s-other"}'::jsonb)`, /shows_definition_is_this_show/)
await refused('cannot save something that is not a show file', ADMIN, `insert into public.shows (id, name, definition) values ('s-junk01', 'X', '{"v":2}'::jsonb)`, /shows_definition_is_this_show/)
await refused('cannot save a show that names a judge', ADMIN, `insert into public.shows (id, name, definition) values ('s-judge01', 'X', '{"format":"hss-show","id":"s-judge01","meets":[{"id":"m1","judges":["Pat Example"]}]}'::jsonb)`, /shows_no_judge_names/)
await allowed('can save a show whose days have an empty judges list', ADMIN, `insert into public.shows (id, name, definition, published) values ('s-judge02', 'X', '{"format":"hss-show","id":"s-judge02","meets":[{"id":"m1","judges":[]}]}'::jsonb, false)`)
await refused('cannot save a show with no name', ADMIN, `insert into public.shows (id, name, definition) values (${show('s-noname', '  ')})`, /shows_name_present/)
await refused('cannot hand a show to another owner', ADMIN, `insert into public.shows (id, name, definition, owner) values (${show('s-owner1')}, '${OTHER}')`, /row-level security/)

console.log('\n  A phone with only the app’s key')
await allowed('reads published shows', 'anon', `select id, name from public.shows`, (r) => r.rows.length === 1 && r.rows[0].id === 's-abc123')
await refused('cannot add a show', 'anon', `insert into public.shows (id, name, definition) values (${show('s-anon01')})`, /permission denied|row-level security/)
await refused('cannot change a show', 'anon', `update public.shows set name = 'hacked' where id = 's-abc123'`, /permission denied/)
await refused('cannot remove a show', 'anon', `delete from public.shows where id = 's-abc123'`, /permission denied/)
await refused('cannot see who the admins are', 'anon', `select * from public.show_admins`, /permission denied/)
await refused('cannot run the admin check at all', 'anon', `select public.is_show_admin() as yes`, /permission denied/)

console.log('\n  A signed-in person who is not a show admin')
await allowed('reads published shows only', OTHER, `select id from public.shows`, (r) => r.rows.length === 1)
await refused('cannot add a show', OTHER, `insert into public.shows (id, name, definition) values (${show('s-other1')})`, /row-level security/)
await refused('cannot change a show', OTHER, `update public.shows set name = 'hacked' where id = 's-abc123' returning id`, /row-level security/)
await refused('cannot remove a show', OTHER, `delete from public.shows where id = 's-abc123' returning id`, /row-level security/)
await refused('cannot make themselves an admin', OTHER, `insert into public.show_admins (user_id) values ('${OTHER}')`, /permission denied/)
await allowed('sees no admin rows but their own', OTHER, `select * from public.show_admins`, (r) => r.rows.length === 0)
await allowed('is told it is not an admin', OTHER, `select public.is_show_admin() as yes`, (r) => r.rows[0].yes === false)
await allowed('while the admin is told yes', ADMIN, `select public.is_show_admin() as yes`, (r) => r.rows[0].yes === true)

console.log('\n  Pictures of pattern book pages')
const page = (name, bucket = 'pattern-pages') => `insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}') returning id`
await allowed('a show admin adds a picture', ADMIN, page('pages/pg-admin1.jpg'), (r) => r.rows.length === 1)
await refused('a show admin cannot put files in any other bucket', ADMIN, page('x.jpg', 'something-else'), /row-level security/)
await refused('a signed-in person off the list cannot add a picture', OTHER, page('pages/pg-other1.jpg'), /row-level security/)
await refused('a phone with only the app key cannot add a picture', 'anon', page('pages/pg-anon1.jpg'), /row-level security/)
await refused('nor remove one', 'anon', `delete from storage.objects where name = 'pages/pg-admin1.jpg' returning id`, /row-level security/)
await refused('nor can a signed-in person off the list', OTHER, `delete from storage.objects where name = 'pages/pg-admin1.jpg' returning id`, /row-level security/)
await allowed('a show admin removes a picture', ADMIN, `delete from storage.objects where name = 'pages/pg-admin1.jpg' returning id`, (r) => r.rows.length === 1)
const bucket = await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'pattern-pages'`)
if (bucket.rows[0]?.public === true && Number(bucket.rows[0].file_size_limit) === 1048576) ok('the bucket is public to read and takes pictures up to 1 MB')
else fail('the bucket is public to read and takes pictures up to 1 MB', JSON.stringify(bucket.rows))

console.log('\n  Sign-on PINs, scores sent by judges, and published placings')
await allowed('a show admin sets two judges and the office, each with a PIN', ADMIN, `insert into public.show_seats (show_id, role, seat_no, pin) values ('s-abc123', 'judge', 1, '111111'), ('s-abc123', 'judge', 2, '222222'), ('s-abc123', 'office', 1, '333333') returning pin`, (r) => r.rows.length === 3)
await refused('two seats of a show cannot share a PIN', ADMIN, `insert into public.show_seats (show_id, role, seat_no, pin) values ('s-abc123', 'judge', 3, '111111')`, /show_seats_pin_once_per_show/)
await refused('a phone with only the app key cannot read the PINs', 'anon', `select * from public.show_seats`, /permission denied/)
await allowed('nor can a signed-in person off the list', OTHER, `select * from public.show_seats`, (r) => r.rows.length === 0)
await allowed('the right PIN signs on as the seat it belongs to', 'anon', `select * from public.seat_for('s-abc123', '222222')`, (r) => r.rows.length === 1 && r.rows[0].role === 'judge' && r.rows[0].seat_no === 2)
await allowed('a wrong PIN signs on as nothing', 'anon', `select * from public.seat_for('s-abc123', '999999')`, (r) => r.rows.length === 0)
const send = (pin, show = 's-abc123') => `select public.send_class_scores('${show}', ${pin === null ? 'null' : `'${pin}'`}, 'm1:1', 'device-0123456789abcdef', 'Pat Example', '[{"place":1,"back_no":"101","score":141}]'::jsonb, true) as said`
const said = (word) => (r) => r.rows[0].said === word
await allowed('judge 2 sends scores with their PIN', 'anon', send('222222'), said('ok'))
await allowed('judge 1 sends scores with theirs', 'anon', send('111111'), said('ok'))
await allowed('without a PIN nothing is accepted', 'anon', send(null), said('wrong_pin'))
await allowed('nor with a wrong PIN', 'anon', send('123456'), said('wrong_pin'))
await allowed('nor with the office PIN, which is not a judge', 'anon', send('333333'), said('wrong_pin'))
await allowed('nor for a show that is not published', 'anon', send('111111', 's-draft1'), said('not_published'))
await allowed('a signed-in person off the list, with no PIN, is refused too', OTHER, send(null), said('wrong_pin'))
await allowed('a signed-in show admin sends with no PIN', ADMIN, send(null), said('ok'))
await refused('scores can no longer be put in the table directly', 'anon', `insert into public.class_scores (show_id, class_key, device, results) values ('s-abc123', 'm1:1', 'device-0123456789abcdef', '[]'::jsonb)`, /permission denied/)
await refused('a judging device cannot read what was sent', 'anon', `select * from public.class_scores`, /permission denied/)
await allowed('the office PIN reads what the judges sent, and which judge sent it', 'anon', `select seat_no, finished from public.office_scores('s-abc123', '333333') order by seat_no nulls last`, (r) => r.rows.length === 3 && r.rows[0].seat_no === 1 && r.rows[1].seat_no === 2 && r.rows[2].seat_no === null && r.rows[0].finished === true)
await allowed('a judge PIN reads none of it', 'anon', `select * from public.office_scores('s-abc123', '111111')`, (r) => r.rows.length === 0)
await allowed('no PIN reads none of it', 'anon', `select * from public.office_scores('s-abc123', '')`, (r) => r.rows.length === 0)
await allowed('a signed-in show admin reads it with no PIN', ADMIN, `select * from public.office_scores('s-abc123', '')`, (r) => r.rows.length === 3)
const publish = (pin, extra = '') => `select public.office_publish('s-abc123', '${pin}', 'm1:1', '[{"place":1,"back_no":"101","rider":"Avery Example","horse":"Dun It"${extra}}]'::jsonb) as said`
await allowed('a judge PIN cannot publish placings', 'anon', publish('111111'), said('wrong_pin'))
await allowed('nor can no PIN at all', 'anon', publish(''), said('wrong_pin'))
await refused('placings that carry a score are refused, even from the office', 'anon', publish('333333', ',"score":141'), /class_results_no_scores/)
await refused('so are placings that carry a judge\'s note', 'anon', publish('333333', ',"note":"Watch your legs"'), /class_results_no_scores/)
await allowed('the office PIN publishes a class', 'anon', publish('333333'), said('ok'))
await allowed('and publishes it again after a correction', 'anon', publish('333333'), said('ok'))
await allowed('a show admin publishes with no PIN', ADMIN, publish(''), said('ok'))
await allowed('anyone reads published placings', 'anon', `select class_key from public.class_results`, (r) => r.rows.length === 1)
await refused('but cannot change them directly', 'anon', `update public.class_results set placings = '[]'::jsonb`, /permission denied/)
await allowed('a judge PIN cannot take placings down', 'anon', `select public.office_unpublish('s-abc123', '222222', 'm1:1') as said`, said('wrong_pin'))
await allowed('the office PIN can', 'anon', `select public.office_unpublish('s-abc123', '333333', 'm1:1') as said`, said('ok'))
const release = (pin) => `select public.office_release_cards('s-abc123', '${pin}', 'm1:1', '[{"place":1,"back_no":"101","rider":"Avery Example","score":141,"boxes":[1,0,2],"note":"Nice ride"}]'::jsonb) as said`
await allowed('nobody sees a score card before the office releases it', 'anon', `select * from public.class_cards`, (r) => r.rows.length === 0)
await allowed('a judge PIN cannot release score cards', 'anon', release('111111'), said('wrong_pin'))
await allowed('nor can no PIN', 'anon', release(''), said('wrong_pin'))
await refused('nor can anyone write them directly', 'anon', `insert into public.class_cards (show_id, class_key, cards) values ('s-abc123', 'm1:1', '[]'::jsonb)`, /permission denied/)
await allowed('the office PIN releases a class\'s score cards', 'anon', release('333333'), said('ok'))
await allowed('a show admin releases them with no PIN', ADMIN, release(''), said('ok'))
await allowed('then anyone reads them, scores and notes included', 'anon', `select cards from public.class_cards`, (r) => r.rows.length === 1 && r.rows[0].cards[0].score === 141 && r.rows[0].cards[0].note === 'Nice ride')
await allowed('a judge PIN cannot take them down', 'anon', `select public.office_take_down_cards('s-abc123', '111111', 'm1:1') as said`, said('wrong_pin'))
await allowed('the office PIN can', 'anon', `select public.office_take_down_cards('s-abc123', '333333', 'm1:1') as said`, said('ok'))
await allowed('and they are gone from public view', 'anon', `select * from public.class_cards`, (r) => r.rows.length === 0)
console.log('\n  Stewards and requests for a re-ride')
await allowed('a show admin gives the steward a PIN', ADMIN, `insert into public.show_seats (show_id, role, seat_no, pin) values ('s-abc123', 'steward', 1, '444444') returning pin`, (r) => r.rows.length === 1)
await refused('a seat cannot be any other kind', ADMIN, `insert into public.show_seats (show_id, role, seat_no, pin) values ('s-abc123', 'announcer', 1, '555555')`, /show_seats_role/)
await allowed('the steward PIN signs on as the steward', 'anon', `select * from public.seat_for('s-abc123', '444444')`, (r) => r.rows.length === 1 && r.rows[0].role === 'steward')
const ask = (pin, back = '101', show = 's-abc123') => `select public.steward_ask_reride('${show}', '${pin}', 'm1:1', '${back}', 'Horse went lame') as said`
await allowed('the steward asks for a re-ride', 'anon', ask('444444'), said('ok'))
await allowed('asking twice for the same rider does not make a second ask', 'anon', ask('444444'), said('already_asked'))
await allowed('a judge PIN cannot ask as a steward', 'anon', ask('111111', '102'), said('wrong_pin'))
await allowed('nor can the office PIN', 'anon', ask('333333', '102'), said('wrong_pin'))
await allowed('nor can no PIN', 'anon', ask('', '102'), said('wrong_pin'))
await allowed('nor a wrong PIN', 'anon', ask('987654', '102'), said('wrong_pin'))
await allowed('nor for a show that is not published', 'anon', ask('444444', '101', 's-draft1'), said('not_published'))
await allowed('a signed-in show admin can ask with no PIN', ADMIN, ask('', '103'), said('ok'))
await allowed('a signed-in person off the list cannot', OTHER, ask('', '104'), said('wrong_pin'))
await refused('nobody reads the asks directly with only the app key', 'anon', `select * from public.reride_asks`, /permission denied/)
await refused('nor writes them directly', 'anon', `insert into public.reride_asks (show_id, class_key, back_no) values ('s-abc123', 'm1:1', '105')`, /permission denied/)
await allowed('a signed-in person off the list sees none of them', OTHER, `select * from public.reride_asks`, (r) => r.rows.length === 0)
const asks = (pin) => `select public.reride_asks_for('s-abc123', '${pin}') as got`
await allowed('the judge sees what was asked, with the reason and no rider name', 'anon', asks('111111'), (r) => r.rows[0].got.ok === true && r.rows[0].got.asks.length === 2 && r.rows[0].got.asks[0].back_no === '101' && r.rows[0].got.asks[0].reason === 'Horse went lame' && r.rows[0].got.asks[0].status === 'asked' && !('rider' in r.rows[0].got.asks[0]))
await allowed('the steward sees them too, to follow the answer', 'anon', asks('444444'), (r) => r.rows[0].got.ok === true && r.rows[0].got.asks.length === 2)
await allowed('a wrong PIN is told it is wrong and sees nothing', 'anon', asks('987650'), (r) => r.rows[0].got.ok === false && !('asks' in r.rows[0].got))
await allowed('so is no PIN', 'anon', asks(''), (r) => r.rows[0].got.ok === false)
const firstAsk = (await db.query(`select id from public.reride_asks where back_no = '101'`)).rows[0].id
const secondAsk = (await db.query(`select id from public.reride_asks where back_no = '103'`)).rows[0].id
const decide = (pin, id, yes) => `select public.judge_decide_reride('s-abc123', '${pin}', '${id}', ${yes}) as said`
await allowed('the steward cannot approve their own ask', 'anon', decide('444444', firstAsk, true), said('wrong_pin'))
await allowed('nor can the office', 'anon', decide('333333', firstAsk, true), said('wrong_pin'))
await allowed('nor can no PIN', 'anon', decide('', firstAsk, true), said('wrong_pin'))
await allowed('a judge approves it', 'anon', decide('111111', firstAsk, true), said('ok'))
await allowed('and it stays decided', 'anon', decide('222222', firstAsk, false), said('already_decided'))
await allowed('a show admin denies the other with no PIN', ADMIN, decide('', secondAsk, false), said('ok'))
await allowed('an ask that does not exist is not found', 'anon', decide('111111', '00000000-0000-0000-0000-000000000000', true), said('not_found'))
await allowed('the steward sees both answers', 'anon', asks('444444'), (r) => r.rows[0].got.asks.map((a) => a.status).join() === 'approved,denied')
await allowed('once decided, the steward can ask again for that rider', 'anon', ask('444444'), said('ok'))
await db.exec(`delete from public.show_seats where role = 'steward';`)

console.log('\n  The horses list')
await allowed('a show admin lists a horse with what it carries', ADMIN, `insert into public.horses (name, provider, takes_height, max_group) values ('Rocket', 'North College', false, 2), ('Rocket', 'South University', true, 3), ('Dot', '', true, 1) returning name`, (r) => r.rows.length === 3)
await refused('the same horse from the same provider is listed once', ADMIN, `insert into public.horses (name, provider) values ('Rocket', 'North College')`, /horses_pkey/)
await refused('a horse carries up to group 1, 2 or 3', ADMIN, `update public.horses set max_group = 0 where name = 'Dot'`, /horses_max_group/)
await allowed('a show admin changes what a horse carries', ADMIN, `update public.horses set max_group = 3, takes_height = true where name = 'Rocket' and provider = 'North College' returning name`, (r) => r.rows.length === 1)
await allowed('a show admin sets a different limit for one class', ADMIN, `update public.horses set by_class = '{"17": {"takes_height": false, "max_group": 2}}'::jsonb where name = 'Dot' returning by_class`, (r) => r.rows.length === 1 && r.rows[0].by_class['17'].max_group === 2)
await refused('the per-class limits are a set of classes, nothing else', ADMIN, `update public.horses set by_class = '[1, 2]'::jsonb where name = 'Dot'`, /horses_by_class/)
await allowed('a horse with none set has an empty set', ADMIN, `select by_class from public.horses where name = 'Rocket' and provider = 'South University'`, (r) => r.rows.length === 1 && JSON.stringify(r.rows[0].by_class) === '{}')
await refused('a phone with only the app key cannot read the horses list', 'anon', `select * from public.horses`, /permission denied/)
await refused('nor add to it', 'anon', `insert into public.horses (name) values ('Nobody')`, /permission denied/)
await allowed('a signed-in person off the list sees no horses', OTHER, `select * from public.horses`, (r) => r.rows.length === 0)
await refused('and cannot change one', OTHER, `update public.horses set max_group = 1 where name = 'Dot' returning name`, /row-level security/)

console.log('\n  The riders list and coaches')
await allowed('a show admin puts riders on the list with their teams', ADMIN, `insert into public.riders (back_no, rider, team) values ('101', 'Avery Example', 'North College'), ('102', 'Blake Sample', 'North College'), ('201', 'Casey Test', 'South University') returning back_no`, (r) => r.rows.length === 3)
await allowed('and marks a height rider in weight group 2', ADMIN, `update public.riders set height_rider = true, weight_group = 2 where back_no = '101' returning back_no`, (r) => r.rows.length === 1)
await refused('a weight group is 1, 2 or 3', ADMIN, `update public.riders set weight_group = 4 where back_no = '101'`, /riders_weight_group/)
await refused('a phone with only the app key cannot read the riders list', 'anon', `select * from public.riders`, /permission denied/)
await refused('nor add to it', 'anon', `insert into public.riders (back_no, rider) values ('999', 'Nobody')`, /permission denied/)
await allowed('a signed-in person off the list sees no riders', OTHER, `select * from public.riders`, (r) => r.rows.length === 0)
await refused('and cannot change one', OTHER, `update public.riders set weight_group = 3 where back_no = '101' returning back_no`, /row-level security/)
await allowed('a show admin gives each team a coach PIN', ADMIN, `insert into public.teams (team, pin) values ('North College', '700001'), ('South University', '700002') returning team`, (r) => r.rows.length === 2)
await refused('two teams cannot share a PIN', ADMIN, `insert into public.teams (team, pin) values ('West College', '700001')`, /teams_pin_once/)
await refused('a coach PIN is at least six digits', ADMIN, `insert into public.teams (team, pin) values ('West College', '1234')`, /teams_pin/)
await refused('nobody reads the coach PINs with only the app key', 'anon', `select * from public.teams`, /permission denied/)
await allowed('nor does a signed-in person off the list', OTHER, `select * from public.teams`, (r) => r.rows.length === 0)
const coach = (pin) => `select public.coach_riders('${pin}') as got`
await allowed('a coach sees their own team\'s riders and marks, and nobody else\'s', 'anon', coach('700001'), (r) => r.rows[0].got.ok === true && r.rows[0].got.team === 'North College' && r.rows[0].got.riders.length === 2 && r.rows[0].got.riders.every((x) => ['101', '102'].includes(x.back_no)) && r.rows[0].got.riders.find((x) => x.back_no === '101').height_rider === true && r.rows[0].got.riders.find((x) => x.back_no === '101').weight_group === 2)
await allowed('a wrong coach PIN sees nothing', 'anon', coach('700009'), (r) => r.rows[0].got.ok === false && !('riders' in r.rows[0].got))
await allowed('nor does an empty one', 'anon', coach(''), (r) => r.rows[0].got.ok === false)
await allowed('a show PIN is not a coach PIN', 'anon', coach('111111'), (r) => r.rows[0].got.ok === false)
const mark = (pin, back, height, group) => `select public.coach_set_mark('${pin}', '${back}', ${height}, ${group}) as said`
await allowed('a coach marks one of their riders', 'anon', mark('700001', '102', true, 3), said('ok'))
await allowed('but not another team\'s rider', 'anon', mark('700001', '201', true, 3), said('not_yours'))
await allowed('nor with a wrong PIN', 'anon', mark('700009', '102', false, 1), said('wrong_pin'))
await allowed('nor into a group that does not exist', 'anon', mark('700001', '102', false, 5), said('bad_group'))
const marks = await db.query(`select back_no, height_rider, weight_group from public.riders order by back_no`)
if (JSON.stringify(marks.rows) === JSON.stringify([{ back_no: '101', height_rider: true, weight_group: 2 }, { back_no: '102', height_rider: true, weight_group: 3 }, { back_no: '201', height_rider: false, weight_group: 1 }])) ok('only the coach\'s own rider changed')
else fail('only the coach\'s own rider changed', JSON.stringify(marks.rows))
await db.exec('delete from private.pin_failures;')
for (let i = 0; i < 10; i++) await as('anon', `select public.coach_riders('80000${i}')`)
await refused('after ten wrong coach PINs in a row, even the right one is refused for a while', 'anon', coach('700001'), /too_many_tries/)
await allowed('the show PINs are counted apart and still work', 'anon', `select * from public.seat_for('s-abc123', '111111')`, (r) => r.rows.length === 1)
await db.exec('delete from private.pin_failures;')
await allowed('a published show still says nothing about height riders or weight groups', 'anon', `select definition::text as t from public.shows`, (r) => r.rows.every((x) => !/height_rider|weight_group/.test(x.t)))

await db.exec('delete from private.pin_failures;')
for (let i = 0; i < 10; i++) await as('anon', `select * from public.seat_for('s-abc123', '00000${i}')`)
await refused('after ten wrong PINs in a row, even the right one is refused for a while', 'anon', `select * from public.seat_for('s-abc123', '111111')`, /too_many_tries/)
await db.exec('delete from private.pin_failures;')
await allowed('and works again afterwards', 'anon', `select * from public.seat_for('s-abc123', '111111')`, (r) => r.rows.length === 1)

console.log('\n  A second show admin')
await db.exec(`insert into public.show_admins (user_id, note) values ('${OTHER}', 'show secretary');`)
await allowed('can publish over a show someone else set up', OTHER, `insert into public.shows (id, name, definition) values (${show('s-abc123', 'Spring show, revised')}) on conflict (id) do update set name = excluded.name, definition = excluded.definition returning id`, (r) => r.rows.length === 1)
await db.exec(`delete from public.show_admins where user_id = '${OTHER}';`)
await refused('and loses that the moment they are taken off the list', OTHER, `update public.shows set name = 'again' where id = 's-abc123' returning id`, /row-level security/)

console.log('\n  A show stored before judges were ruled out')
await db.exec(`
  alter table public.shows drop constraint shows_no_judge_names;
  insert into public.shows (id, name, definition, owner) values ('s-older01', 'Older', '{"format":"hss-show","id":"s-older01","meets":[{"id":"m1","label":"Saturday","judges":["Pat Example"]},{"id":"m2","label":"Sunday","judges":[]}]}'::jsonb, '${ADMIN}');
`)
try {
  await db.exec(readFileSync(join(migrationsDir, files.find((f) => f.includes('no_judges'))), 'utf8'))
  const older = await db.query(`select definition from public.shows where id = 's-older01'`)
  const meets = older.rows[0].definition.meets
  if (meets.length === 2 && meets[0].label === 'Saturday' && meets[1].label === 'Sunday' && meets.every((m) => m.judges.length === 0)) ok('has its judges removed, and keeps its days in order')
  else fail('has its judges removed, and keeps its days in order', JSON.stringify(meets))
} catch (e) {
  fail('has its judges removed, and keeps its days in order', e.message)
}

console.log('\n  After the changes')
const after = await db.query(`select name, owner, updated_at > created_at as touched from public.shows where id = 's-abc123'`)
if (after.rows[0]?.name === 'Spring show, revised' && after.rows[0].owner === ADMIN) ok('the show kept its owner and holds only the admin’s change')
else fail('the show kept its owner and holds only the admin’s change', JSON.stringify(after.rows))
await allowed('the admin can take a show off the server', ADMIN, `delete from public.shows where id = 's-abc123' returning id`, (r) => r.rows.length === 1)

console.log(failures === 0 ? '\nAll database checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
