import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshShows, setBackendForTests, signIn, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { loadSentScores, placingsFrom, resetScoreSendingForTests, sendPendingScores } from '../cloud/scores'
import { clearSeatForTests, currentSeat, signOn } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import { classKey, type ShowFile } from '../data/fixture'
import { clearShows } from '../data/shows'
import { classState, clearAll, getState, saveRun, setClassFinished, setJudgeName } from '../store'
import { PublicShow } from './PublicScreens'
import { ResultsAdminScreen } from './ResultsAdminScreen'

const SHOW = 's-res000001'
const KEY = classKey(`${SHOW}-m1`, '1')
const NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules']

/** A made-up published show: one reining class of ten riders, three maneuvers. */
function show(): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id: SHOW,
    name: 'Made-up Results Show',
    host: '',
    association: 'IHSA',
    meets: [
      {
        id: `${SHOW}-m1`,
        label: 'Saturday',
        date: '2027-02-06',
        coach_meeting: '',
        start_time: '',
        judges: [],
        classes: [
          {
            id: '1',
            class_no: '17',
            name: 'Open Reining',
            section: '',
            card_family: 'pattern',
            rule_set: 'ihsa-reining',
            pattern_id: 'p-res-1',
            notes: '',
            entries: NAMES.map((n, i) => ({ draw: i + 1, back_no: String(401 + i), rider: `${n} Example`, horse: `Horse ${i + 1}` })),
          },
        ],
      },
    ],
    patterns: [{ id: 'p-res-1', name: 'Made-up pattern', kind: 'reining', source_page: 0, boxes: [1, 2, 3].map((n) => ({ n, abbr: `M${n}`, label: `Maneuver ${n}`, tags: [] })) }],
  }
}

const run = (backNo: string) => classState(getState(), KEY).runs.find((r) => r.backNo === backNo)!

/** Score the first eight riders 73 down to 69½, mark the ninth DQ, and leave the tenth untouched. */
function scoreTheClass() {
  const boxes = [[3, 3, 0], [3, 2, 0], [3, 1, 0], [3, 0, 0], [2, 0, 0], [1, 0, 0], [0, 0, 0], [-1, 0, 0]]
  boxes.forEach((b, i) => saveRun(KEY, { ...run(String(401 + i)), boxes: b, extras: { fe: 0 }, scored: true }))
  saveRun(KEY, { ...run('409'), boxes: [0, 0, 0], extras: { fe: 0 }, mark: 'DQ', scored: true })
}

let server: FakeBackend

beforeEach(async () => {
  clearAll()
  clearShows()
  clearCloudCache()
  resetScoreSendingForTests()
  window.location.hash = ''
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.shows = [show()]
  // The show admin gave the show two judges and an office, each with a PIN.
  server.seats[SHOW] = [
    { role: 'judge', seatNo: 1, pin: '111111' },
    { role: 'judge', seatNo: 2, pin: '222222' },
    { role: 'office', seatNo: 1, pin: '333333' },
  ]
  clearSeatForTests()
  setBackendForTests(server)
  await startCloud()
})

afterEach(() => cleanup())

describe('a judging device sends its scores', () => {
  it('sends nothing from a device that has not signed on as a judge', async () => {
    scoreTheClass()
    expect(await sendPendingScores()).toBe(0)
    await signOn(SHOW, '333333') // the office PIN is not a judge
    expect(await sendPendingScores()).toBe(0)
    expect(server.sent).toHaveLength(0)
  })

  it('tells two judges apart by their PINs, and passes on that a class is marked finished', async () => {
    await signOn(SHOW, '111111')
    scoreTheClass()
    await sendPendingScores()
    // A second device, signed on with the other judge's PIN.
    resetScoreSendingForTests()
    await signOn(SHOW, '222222')
    setClassFinished(KEY, true)
    await sendPendingScores()
    expect(server.sent.map((s) => [s.seatNo, s.finished])).toEqual([[1, false], [2, true]])
    expect(server.sent[0].device).not.toBe(server.sent[1].device)
  })

  it('stops sending when the admin changes the PIN, keeps the scores, and says so', async () => {
    await signOn(SHOW, '111111')
    server.seats[SHOW] = [{ role: 'judge', seatNo: 1, pin: '444444' }]
    scoreTheClass()
    expect(await sendPendingScores()).toBe(0)
    expect(currentSeat()?.rejected).toBe(true)
    expect(run('401').scored).toBe(true)
    expect(server.sent).toHaveLength(0)
  })

  it('sends a class once something is entered, and again only when it changes', async () => {
    await signOn(SHOW, '111111')
    expect(await sendPendingScores()).toBe(0)
    setJudgeName(`${SHOW}-m1`, 'Pat Example')
    saveRun(KEY, { ...run('401'), boxes: [3, 3, 0], extras: { fe: 0 }, scored: true })
    expect(await sendPendingScores()).toBe(1)
    expect(server.sent).toHaveLength(1)
    expect(server.sent[0]).toMatchObject({ showId: SHOW, classKey: KEY, judge: 'Pat Example' })
    expect(server.sent[0].rows.find((r) => r.back_no === '401')).toMatchObject({ place: 1, score: 146, rider: 'Avery Example', rode: true })
    expect(await sendPendingScores()).toBe(0)
    saveRun(KEY, { ...run('402'), boxes: [3, 2, 0], extras: { fe: 0 }, scored: true })
    expect(await sendPendingScores()).toBe(1)
    expect(server.sent).toHaveLength(2)
    // The same device both times.
    expect(server.sent[0].device).toBe(server.sent[1].device)
  })

  it('sends nothing for the sample shows that come with the app', async () => {
    await signOn(SHOW, '111111')
    const sampleKey = classKey('meet-5', '1')
    const first = classState(getState(), sampleKey).runs[0]
    saveRun(sampleKey, { ...first, boxes: first.boxes.map(() => 1), scored: true })
    expect(await sendPendingScores()).toBe(0)
    expect(server.sent).toHaveLength(0)
  })

  it('loses nothing with no signal: the class goes when the server is back', async () => {
    await signOn(SHOW, '111111')
    server.down = true
    scoreTheClass()
    expect(await sendPendingScores()).toBe(0)
    expect(run('401').scored).toBe(true)
    server.down = false
    expect(await sendPendingScores()).toBe(1)
    expect(server.sent[0].rows.filter((r) => r.place !== null)).toHaveLength(8)
  })

  it('cannot read what was sent. A show admin sees the latest from each device', async () => {
    await signOn(SHOW, '111111')
    scoreTheClass()
    await sendPendingScores()
    saveRun(KEY, { ...run('410'), boxes: [0, 0, 0], extras: { fe: 0 }, scored: true })
    await sendPendingScores()
    expect(await loadSentScores(SHOW)).toEqual({ ok: true, latest: [] })
    await signIn('admin@example.com', 'right')
    const seen = await loadSentScores(SHOW)
    expect(seen.ok && seen.latest).toHaveLength(1)
    expect(seen.ok && seen.latest[0].rows.filter((r) => r.place !== null)).toHaveLength(9)
  })
})

describe('placings for the public', () => {
  it('go all the way down, then riders who rode with no place, and carry no score', () => {
    scoreTheClass()
    const cls = show().meets[0].classes[0]
    void cls
    const rows = [
      ...NAMES.slice(0, 8).map((n, i) => ({ place: i + 1, tied: false, back_no: String(401 + i), rider: `${n} Example`, horse: '', score: 146 - i, mark: 'none', rode: true })),
      { place: null, tied: false, back_no: '409', rider: 'Indy Example', horse: '', score: null, mark: 'DQ', rode: true },
      { place: null, tied: false, back_no: '410', rider: 'Jules Example', horse: '', score: null, mark: 'none', rode: false },
    ]
    const out = placingsFrom(rows.slice().reverse())
    expect(out.map((p) => [p.place, p.back_no])).toEqual([[1, '401'], [2, '402'], [3, '403'], [4, '404'], [5, '405'], [6, '406'], [7, '407'], [8, '408'], [null, '409']])
    expect(JSON.stringify(out)).not.toMatch(/score|mark|146/)
  })
})

describe('a show admin publishes a class', () => {
  it('is not offered to someone who is not signed in', () => {
    render(<ResultsAdminScreen showId={SHOW} />)
    expect(screen.getByText(/Sign on to carry on/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Publish this class/ })).toBeNull()
  })

  it('sees the scores sent, publishes the placings, and the public page shows them with no scores', async () => {
    await signOn(SHOW, '222222')
    setJudgeName(`${SHOW}-m1`, 'Pat Example')
    scoreTheClass()
    setClassFinished(KEY, true)
    await sendPendingScores()
    clearSeatForTests()
    await signIn('admin@example.com', 'right')

    render(<ResultsAdminScreen showId={SHOW} />)
    const block = (await screen.findByText(/Sent by judge 2, Pat Example,/)).closest('section')!
    expect(within(block).getByText('The judge has marked this class finished.')).toBeTruthy()
    const lines = within(block).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines[0]).toMatch(/^1.*401.*Avery Example.*73$/)
    expect(lines[7]).toMatch(/^8.*408.*Harper Example.*69½$/)
    expect(lines[8]).toMatch(/^No place.*409.*Indy Example.*DQ$/)
    // The rider with nothing entered is not listed.
    expect(lines).toHaveLength(9)
    fireEvent.click(within(block).getByRole('button', { name: 'Publish this class’s placings' }))
    expect(await screen.findByText(/Placings for Open Reining are on the public page/)).toBeTruthy()
    expect(await screen.findByText(/Placings published at/)).toBeTruthy()
    expect(server.placings[SHOW][0].placings).toHaveLength(9)
    expect(JSON.stringify(server.placings)).not.toMatch(/score|146|DQ/)
    cleanup()

    // What a spectator sees, on a phone that is not signed in.
    setBackendForTests(server)
    await refreshShows()
    render(<PublicShow showId={SHOW} />)
    expect(await screen.findByText('Placings posted')).toBeTruthy()
    const cls = screen.getByText('1. Open Reining').closest('details')!
    const placings = within(cls).getAllByRole('list')[0]
    const shown = within(placings).getAllByRole('listitem').map((li) => li.textContent)
    expect(shown).toHaveLength(9)
    expect(shown[0]).toMatch(/^1.*401.*Avery Example/)
    expect(shown[6]).toMatch(/^7.*407.*Gray Example/)
    expect(shown[7]).toMatch(/^8.*408.*Harper Example/)
    expect(shown[8]).toMatch(/^No place.*409.*Indy Example/)
    expect(cls.textContent).not.toMatch(/73|69½|DQ/)
  })

  it('the show office, signed on with its PIN, publishes a class. A judge\'s PIN cannot', async () => {
    await signOn(SHOW, '111111')
    scoreTheClass()
    await sendPendingScores()
    // The judge's device asks for the office page: it gets no scores and no way to publish.
    render(<ResultsAdminScreen showId={SHOW} />)
    expect(screen.getByText(/Sign on to carry on/)).toBeTruthy()
    cleanup()

    await signOn(SHOW, '333333')
    render(<ResultsAdminScreen showId={SHOW} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish this class’s placings' }))
    expect(await screen.findByText(/Placings for Open Reining are on the public page/)).toBeTruthy()
    expect(server.placings[SHOW][0].placings).toHaveLength(9)
  })

  it('can take a class’s placings down again', async () => {
    await signOn(SHOW, '111111')
    scoreTheClass()
    await sendPendingScores()
    clearSeatForTests()
    await signIn('admin@example.com', 'right')
    window.confirm = () => true
    render(<ResultsAdminScreen showId={SHOW} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish this class’s placings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Take these placings down' }))
    expect(await screen.findByText(/are taken down/)).toBeTruthy()
    expect(server.placings[SHOW]).toEqual([])
  })
})
