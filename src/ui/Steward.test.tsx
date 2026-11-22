import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { setBackendForTests, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { resetRerideAsksForTests } from '../cloud/rerides'
import { resetScoreSendingForTests } from '../cloud/scores'
import { clearSeatForTests, currentSeat } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import { classKey, type ShowFile } from '../data/fixture'
import { clearShows } from '../data/shows'
import { classState, clearAll, getState } from '../store'

const SHOW = 's-stew00001'
const MEET = `${SHOW}-m1`
const KEY = classKey(MEET, '1')

function show(): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id: SHOW,
    name: 'Made-up Steward Show',
    host: '',
    association: 'IHSA',
    meets: [
      {
        id: MEET,
        label: 'Sunday',
        date: '2027-04-04',
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
            pattern_id: 'p-stew-1',
            notes: '',
            entries: [
              { draw: 1, back_no: '501', rider: 'Avery Example', horse: 'Dun It' },
              { draw: 2, back_no: '502', rider: 'Blake Sample', horse: 'Rocket' },
            ],
            alternates: ['Spare One', 'Spare Two'],
          },
        ],
      },
    ],
    patterns: [{ id: 'p-stew-1', name: 'Made-up pattern', kind: 'reining', source_page: 0, boxes: [{ n: 1, abbr: 'W', label: 'Walk', tags: [] }] }],
  }
}

let server: FakeBackend

async function open(hash: string) {
  window.location.hash = hash
  await startCloud()
  render(<App />)
}

async function signOnAs(button: string, pin: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${button}`) }))
  fireEvent.change(screen.getByLabelText('PIN'), { target: { value: pin } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign on' }))
}

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  clearSeatForTests()
  resetScoreSendingForTests()
  resetRerideAsksForTests()
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.shows = [show()]
  server.seats[SHOW] = [
    { role: 'judge', seatNo: 1, pin: '111111' },
    { role: 'office', seatNo: 1, pin: '333333' },
    { role: 'steward', seatNo: 1, pin: '444444' },
  ]
  setBackendForTests(server)
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('a steward', () => {
  it('signs on with the steward PIN and asks the judge for a re-ride', async () => {
    await open('')
    await signOnAs('Steward', '444444')
    expect(await screen.findByText('Ask the judge for a re-ride. The judge approves or denies it on their own screen.')).toBeTruthy()
    expect(currentSeat()).toMatchObject({ role: 'steward', showId: SHOW })
    expect(window.location.hash).toBe(`#/s/${SHOW}/steward`)
    // No scores and nothing to set up: only the class, its riders and the asks.
    expect(screen.queryByRole('button', { name: /Publish|Change the setup|Draw the horses/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: KEY } })
    fireEvent.change(screen.getByLabelText('Reason, if you want to give one'), { target: { value: 'Horse went lame' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a re-ride for 501' }))
    expect(await screen.findByText('Asked the judge for a re-ride for 501. The answer shows below.')).toBeTruthy()
    expect(server.asks[SHOW]).toMatchObject([{ classKey: KEY, backNo: '501', reason: 'Horse went lame', status: 'asked' }])
    // It is listed as waiting, and cannot be asked twice.
    expect(await screen.findByText('Waiting for the judge')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ask for a re-ride for 501' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Ask for a re-ride for 502' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot open the judge’s classes or the office’s page', async () => {
    await open('')
    await signOnAs('Steward', '444444')
    await screen.findByLabelText('Class')
    cleanup()
    await open(`#/m/${MEET}/c/1`)
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
    cleanup()
    await open(`#/s/${SHOW}/results`)
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
  })

  it('is told when the PIN is not a steward’s', async () => {
    // The office PIN signs on as the office. Its device cannot ask for a re-ride.
    expect(await server.askReride(SHOW, '333333', KEY, '501', '')).toBe('wrong_pin')
    expect(await server.askReride(SHOW, '111111', KEY, '501', '')).toBe('wrong_pin')
    expect(await server.askReride(SHOW, '', KEY, '501', '')).toBe('wrong_pin')
    expect(server.asks[SHOW] ?? []).toHaveLength(0)
  })
})

describe('the judge answers', () => {
  async function judgeOpensClass() {
    await open('')
    await signOnAs('Judge or scribe', '111111')
    await screen.findByRole('button', { name: /Sunday/ })
    cleanup()
    await open(`#/m/${MEET}/c/1`)
    await screen.findByText('Avery Example')
  }

  it('approves a re-ride: the rider gets the first alternate, a clear card and the last place', async () => {
    await server.askReride(SHOW, '444444', KEY, '501', 'Horse went lame')
    await judgeOpensClass()
    const box = await screen.findByRole('group', { name: 'Re-ride asked for 501' })
    expect(box.textContent).toContain('The steward asks for a re-ride for 501, Avery Example. Horse went lame')
    // The class's first alternate is already picked.
    expect((within(box).getByLabelText('Horse for the re-ride') as HTMLSelectElement).value).toBe('Spare One')
    fireEvent.click(within(box).getByRole('button', { name: 'Approve the re-ride' }))

    const runs = classState(getState(), KEY).runs
    expect(runs.map((r) => r.backNo)).toEqual(['502', '501'])
    expect(runs[1].horse).toBe('Spare One')
    expect(runs[1].previous).toHaveLength(1)
    expect(runs[1].previous![0].horse).toBe('Dun It')
    await waitFor(() => expect(server.asks[SHOW][0].status).toBe('approved'))
    // The box is gone and the screen says what happened.
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Re-ride asked for 501' })).toBeNull())
    expect(screen.getAllByRole('status').map((el) => el.textContent).join(' ')).toContain('Re-ride approved for 501 on Spare One. They ride last, on a clear card.')
  })

  it('denies a re-ride and leaves the rider as they were', async () => {
    await server.askReride(SHOW, '444444', KEY, '502', '')
    await judgeOpensClass()
    const box = await screen.findByRole('group', { name: 'Re-ride asked for 502' })
    fireEvent.click(within(box).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(server.asks[SHOW][0].status).toBe('denied'))
    const runs = classState(getState(), KEY).runs
    expect(runs.map((r) => r.backNo)).toEqual(['501', '502'])
    expect(runs[1].previous).toBeUndefined()
    expect(runs[1].horse).toBe('Rocket')
  })

  it('shows on the day screen that a re-ride is waiting, and leads to the class', async () => {
    await server.askReride(SHOW, '444444', KEY, '501', '')
    await open('')
    await signOnAs('Judge or scribe', '111111')
    fireEvent.click(await screen.findByRole('button', { name: /Sunday/ }))
    const box = await screen.findByRole('group', { name: 'Re-rides asked for' })
    fireEvent.click(within(box).getByRole('button', { name: '501 in 1. Open Reining' }))
    expect(window.location.hash).toBe(`#/m/${MEET}/c/1`)
  })

  it('keeps the answer and sends it later when the server cannot be reached', async () => {
    await server.askReride(SHOW, '444444', KEY, '502', '')
    await judgeOpensClass()
    const box = await screen.findByRole('group', { name: 'Re-ride asked for 502' })
    server.down = true
    fireEvent.click(within(box).getByRole('button', { name: 'Deny' }))
    // Answered on this device at once, though the server has not heard.
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Re-ride asked for 502' })).toBeNull())
    expect(server.asks[SHOW][0].status).toBe('asked')
    server.down = false
    const { refreshRerideAsks } = await import('../cloud/rerides')
    await refreshRerideAsks(SHOW)
    expect(server.asks[SHOW][0].status).toBe('denied')
  })

  it('stops asking the server once its PIN is no longer accepted', async () => {
    await judgeOpensClass()
    server.seats[SHOW] = [{ role: 'judge', seatNo: 1, pin: '999999' }]
    const { refreshRerideAsks } = await import('../cloud/rerides')
    await refreshRerideAsks(SHOW)
    expect(currentSeat()?.rejected).toBe(true)
  })
})
