import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { setBackendForTests, signIn, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { resetScoreSendingForTests } from '../cloud/scores'
import { clearSeatForTests, currentSeat } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import type { ShowFile } from '../data/fixture'
import { clearShows } from '../data/shows'
import { clearAll } from '../store'
import { SeatsScreen } from './SeatsScreen'

const SHOW = 's-sign00001'

function show(): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id: SHOW,
    name: 'Made-up Sign-on Show',
    host: '',
    association: 'IHSA',
    meets: [
      {
        id: `${SHOW}-m1`,
        label: 'Saturday',
        date: '2027-04-03',
        coach_meeting: '',
        start_time: '',
        judges: [],
        classes: [{ id: '1', class_no: '17', name: 'Open Reining', section: '', card_family: 'pattern', rule_set: 'ihsa-reining', pattern_id: 'p-sign-1', notes: '', entries: [{ draw: 1, back_no: '501', rider: 'Avery Example', horse: 'Dun It' }] }],
      },
    ],
    patterns: [{ id: 'p-sign-1', name: 'Made-up pattern', kind: 'reining', source_page: 0, boxes: [{ n: 1, abbr: 'W', label: 'Walk', tags: [] }] }],
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
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.shows = [show()]
  server.seats[SHOW] = [
    { role: 'judge', seatNo: 1, pin: '111111' },
    { role: 'judge', seatNo: 2, pin: '222222' },
    { role: 'office', seatNo: 1, pin: '333333' },
  ]
  setBackendForTests(server)
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('the first screen asks who is using the device', () => {
  it('offers the roles, and nothing to score or set up', async () => {
    await open('')
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Show office/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Admin/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Rider, coach or spectator/ })).toBeTruthy()
    expect(screen.queryByText(/IHSA Western Show/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Create a show|Open a show file|Clear scores/ })).toBeNull()
  })

  it('going straight to a scoring link without signing on gives the sign-on screen', async () => {
    for (const link of [`#/m/${SHOW}-m1`, `#/m/${SHOW}-m1/c/1`, `#/s/${SHOW}`, `#/s/${SHOW}/results`, '#/m/meet-5/c/1']) {
      await open(link)
      expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
      expect(screen.queryByText('Avery Example')).toBeNull()
      cleanup()
    }
  })

  it('a judge signs on with their PIN, reaches their show, and can sign off', async () => {
    await open('')
    await signOnAs('Judge or scribe', '222222')
    expect(await screen.findByText(/Signed on as Judge 2, Made-up Sign-on Show/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Saturday/ })).toBeTruthy()
    expect(currentSeat()).toMatchObject({ role: 'judge', seatNo: 2 })
    // The judge's own show only: no setup, no publishing.
    expect(screen.queryByRole('button', { name: /Change the setup|Publish|Judges and PINs/ })).toBeNull()
    // Nor files: a judge has nothing to export or download. The show is kept on the device by itself.
    expect(screen.queryByRole('button', { name: /Export|Download/ })).toBeNull()
    expect(screen.getByText(/kept on this device/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign off' }))
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
    expect(currentSeat()).toBeNull()
  })

  it('a wrong PIN is refused in plain words', async () => {
    await open('')
    await signOnAs('Judge or scribe', '999999')
    expect((await screen.findByRole('alert')).textContent).toMatch(/not right for this show/)
    expect(currentSeat()).toBeNull()
  })

  it('a judge cannot open the office page, or another show', async () => {
    await open('')
    await signOnAs('Judge or scribe', '111111')
    await screen.findByText(/Signed on as Judge 1/)
    cleanup()
    await open(`#/s/${SHOW}/results`)
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
    cleanup()
    await open('#/m/meet-5/c/1')
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
  })

  it('the show office signs on with its PIN and lands on the publishing page, not the score cards', async () => {
    await open('')
    await signOnAs('Show office', '333333')
    expect(await screen.findByText(/Signed on as Show office/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Publish placings' })).toBeTruthy()
    cleanup()
    await open(`#/m/${SHOW}-m1/c/1`)
    expect(await screen.findByRole('button', { name: /^Judge or scribe/ })).toBeTruthy()
  })

  it('an admin, signed in with an account, gets everything', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    await open('')
    expect(await screen.findByRole('button', { name: 'Create a show' })).toBeTruthy()
    cleanup()
    await open(`#/s/${SHOW}`)
    expect(await screen.findByRole('button', { name: 'Export results as CSV' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download the show file' })).toBeTruthy()
    cleanup()
    await open(`#/m/${SHOW}-m1/c/1`)
    expect(await screen.findByText('Avery Example')).toBeTruthy()
  })
})

describe('a show admin sets the judges and their PINs', () => {
  it('starts a show with one judge and the office, each with a PIN of its own', async () => {
    server.seats = {}
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<SeatsScreen showId={SHOW} />)
    const judge = (await screen.findByLabelText('Judge 1 PIN')) as HTMLInputElement
    const office = screen.getByLabelText('Show office PIN') as HTMLInputElement
    expect(judge.value).toMatch(/^\d{6}$/)
    expect(office.value).toMatch(/^\d{6}$/)
    expect(judge.value).not.toBe(office.value)
  })

  it('sets two judges with separate PINs and saves them', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<SeatsScreen showId={SHOW} />)
    fireEvent.change(await screen.findByLabelText('Number of judges'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Judge 2 PIN'), { target: { value: '424242' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the PINs' }))
    expect(await screen.findByText(/Saved/)).toBeTruthy()
    const saved = server.seats[SHOW]
    // A show set up before stewards existed gets a steward PIN with the next save.
    expect(saved.map((s) => `${s.role} ${s.seatNo}`)).toEqual(['judge 1', 'judge 2', 'judge 3', 'office 1', 'steward 1'])
    expect(saved[1].pin).toBe('424242')
    expect(saved[4].pin).toBe((screen.getByLabelText('Steward PIN') as HTMLInputElement).value)
    expect(new Set(saved.map((s) => s.pin)).size).toBe(5)
  })

  it('refuses two seats with the same PIN', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<SeatsScreen showId={SHOW} />)
    fireEvent.change(await screen.findByLabelText('Judge 2 PIN'), { target: { value: '111111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the PINs' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/same PIN/)
    await waitFor(() => expect(server.seats[SHOW][1].pin).toBe('222222'))
  })

  it('is not open to a judge or to someone not signed in', async () => {
    await startCloud()
    render(<SeatsScreen showId={SHOW} />)
    expect(screen.getByText(/Only a show admin sets the PINs/)).toBeTruthy()
    expect(screen.queryByLabelText('Judge 1 PIN')).toBeNull()
  })
})
