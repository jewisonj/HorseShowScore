import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBackendForTests, signIn, signOut, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCloudCache } from '../data/cloudShows'
import type { ShowFile } from '../data/fixture'
import { clearShows, saveShow, userShows } from '../data/shows'
import { sampleShowWorkbook } from '../setup/testWorkbook'
import { resultsCsv } from '../results'
import { clearAll, getState } from '../store'
import { AccountScreen } from './AccountScreen'
import { Home } from './Home'
import { MeetScreen } from './MeetScreen'
import { SetupScreen } from './SetupScreen'
import { ShowScreen } from './ShowScreen'

/** A made-up show with one reining class and one Level II class, neither with a pattern yet unless given. */
function show(id: string, patternId = ''): ShowFile {
  const cls = (cid: string, class_no: string, name: string, rule_set: string) => ({
    id: cid,
    class_no,
    name,
    section: '',
    card_family: 'pattern' as const,
    rule_set,
    pattern_id: patternId,
    notes: '',
    entries: [{ draw: 1, back_no: '201', rider: 'Casey Example', horse: 'Sorrel' }],
  })
  return {
    format: 'hss-show',
    version: 1,
    id,
    name: 'Made-up Fall Show',
    host: 'Made-up College',
    association: 'IHSA',
    meets: [
      {
        id: `${id}-m1`,
        label: 'Saturday',
        date: '2027-10-02',
        coach_meeting: '',
        start_time: '',
        judges: [],
        classes: [cls('1', '17', 'Open Reining', 'ihsa-reining'), cls('2', '14', 'Level II Horsemanship', 'ihsa-horsemanship')],
      },
    ],
    patterns: patternId
      ? [{ id: patternId, name: 'Made-up pattern', kind: 'reining', source_page: 0, boxes: [1, 2, 3].map((n) => ({ n, abbr: `M${n}`, label: `Maneuver ${n}`, tags: [] })) }]
      : [],
  }
}

let server: FakeBackend

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  window.location.hash = ''
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.accounts['judge@example.com'] = { password: 'right', admin: false }
  setBackendForTests(server)
})

afterEach(() => cleanup())

describe('the show list with a server', () => {
  it('lists a published show without any file being passed around', async () => {
    server.shows = [show('s-fall00001', 'p-fall-1')]
    render(<Home />)
    expect(await screen.findByRole('button', { name: /Made-up Fall Show/ })).toBeTruthy()
    expect(await screen.findByText(/Published shows were read at/)).toBeTruthy()
  })

  it('says so when the server cannot be reached, and still lists what the device has', async () => {
    server.down = true
    render(<Home />)
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /IHSA Western Meets/ })).toBeTruthy()
  })
})

describe('signing in', () => {
  it('a show admin signs in and is told what the account can do', async () => {
    render(<AccountScreen />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/can set up shows and publish them/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })

  it('a wrong password is refused, and an account off the list is told so', async () => {
    render(<AccountScreen />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'judge@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/not on the list of people who can publish/)).toBeTruthy()
  })
})

describe('publishing from the show screen', () => {
  it('a show admin publishes a show made on this device', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001', 'p-fall-1'))
    render(<ShowScreen showId="s-fall00001" />)
    expect(screen.getByText(/on this device only/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish this show' }))
    expect(await screen.findByText(/Every phone that is online lists this show/)).toBeTruthy()
    expect(server.shows.map((s) => s.id)).toEqual(['s-fall00001'])
    expect(userShows()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Take it off the server' })).toBeTruthy()
  })

  it('a show that is not ready is not published, and the screen says why', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001'))
    render(<ShowScreen showId="s-fall00001" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish this show' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/pattern/i)
    expect(server.shows).toHaveLength(0)
  })

  it('a phone that is not signed in can score a published show but not change or unpublish it', async () => {
    server.shows = [show('s-fall00001', 'p-fall-1')]
    await startCloud()
    render(<ShowScreen showId="s-fall00001" />)
    expect(screen.getByRole('button', { name: /Saturday/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change the setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take it off the server' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove this show/ })).toBeNull()
  })
})

describe('the judge on this device', () => {
  it('types a name on the day screen; it goes in this device\'s results and nowhere else', async () => {
    server.shows = [show('s-fall00001', 'p-fall-1')]
    await startCloud()
    render(<MeetScreen meetId="s-fall00001-m1" />)
    fireEvent.change(screen.getByLabelText('Judge on this device'), { target: { value: 'Pat Example' } })
    expect(screen.getByText(/judge Pat Example/)).toBeTruthy()
    const csv = resultsCsv(getState(), server.shows[0].meets)
    expect(csv.split('\n')[1]).toContain('Pat Example')
    expect(JSON.stringify(server.shows)).not.toContain('Pat Example')
  })

  it('setup has no judge field', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001', 'p-fall-1'))
    render(<SetupScreen showId="s-fall00001" />)
    expect(screen.queryByLabelText('Judge')).toBeNull()
  })
})

describe('setting up shows is for the people on the list', () => {
  it('a phone that is not signed in is not offered Create a show, but can still open a show file', async () => {
    render(<Home />)
    expect(await screen.findByRole('button', { name: 'Sign in to set up shows' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create a show' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open a show file' })).toBeTruthy()
  })

  it('going straight to setup without signing in gives a sign-in screen, not setup', async () => {
    render(<SetupScreen />)
    expect(screen.getByRole('heading', { name: 'Sign in to set up shows' })).toBeTruthy()
    expect(screen.queryByText('The show')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(window.location.hash).toBe('#/account')
  })

  it('a signed-in account that is off the list is told so and gets no setup', async () => {
    await startCloud()
    await signIn('judge@example.com', 'right')
    saveShow(show('s-fall00001', 'p-fall-1'))
    render(<SetupScreen showId="s-fall00001" />)
    expect(screen.getByText(/not on the list of people who can set up shows/)).toBeTruthy()
    cleanup()
    render(<Home />)
    expect(screen.queryByRole('button', { name: 'Create a show' })).toBeNull()
  })

  it('a show admin is offered Create a show, and still is when the app is opened again with no signal', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<Home />)
    expect(screen.getByRole('button', { name: 'Create a show' })).toBeTruthy()
    cleanup()
    // The app is closed and opened again where there is no signal.
    server.down = true
    setBackendForTests(server, true)
    render(<Home />)
    expect(screen.getByRole('button', { name: 'Create a show' })).toBeTruthy()
    await startCloud()
    expect(screen.getByRole('button', { name: 'Create a show' })).toBeTruthy()
  })

  it('signing out takes Create a show away, on this visit and the next', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    await signOut()
    setBackendForTests(server, true)
    render(<Home />)
    expect(screen.queryByRole('button', { name: 'Create a show' })).toBeNull()
  })
})

describe('reading the workbook from its Google Sheets link', () => {
  const LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit?usp=sharing'

  it('fills in the classes and the draw, and remembers the link on this computer only', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    server.workbook = sampleShowWorkbook()
    render(<SetupScreen />)
    fireEvent.change(screen.getByLabelText('Google Sheets link'), { target: { value: LINK } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the sheet' }))
    expect(await screen.findByText(/Read \d+ classes and 6 rides over 2 days/)).toBeTruthy()
    expect(server.workbookLinks).toEqual([LINK])
    expect(localStorage.getItem('hss.sheetlinks.v1')).toContain(LINK)
    // Nothing about the link is in the show that would be saved or published.
    expect(JSON.stringify(userShows())).not.toContain('docs.google.com')
  })

  it('says what to do when the sheet is not shared by link', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    server.workbook = null
    render(<SetupScreen />)
    fireEvent.change(screen.getByLabelText('Google Sheets link'), { target: { value: LINK } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the sheet' }))
    expect(await screen.findByText(/Google would not hand over that sheet/)).toBeTruthy()
  })

  it('a link that is not a Google Sheet is refused on this computer, without asking the server', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<SetupScreen />)
    fireEvent.change(screen.getByLabelText('Google Sheets link'), { target: { value: 'https://example.com/spreadsheets/d/abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the sheet' }))
    expect(await screen.findByText(/not a Google Sheets link/)).toBeTruthy()
    expect(server.workbookLinks).toEqual([])
  })
})

describe('reading a pattern book in setup', () => {
  const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).buffer as ArrayBuffer], 'patterns.pdf', { type: 'application/pdf' })

  it('is offered to a signed-in show admin', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001'))
    render(<SetupScreen showId="s-fall00001" />)
    expect(screen.getByRole('button', { name: /Read a pattern book/ })).toBeTruthy()
  })

  it('adds the ticked patterns and gives classes theirs', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001'))
    const boxes = [
      { code: 'Rr S', words: 'LF right, SS right, stop' },
      { code: '4 RS', words: '4 spins right' },
    ]
    server.reader = {
      patterns: [
        { name: 'Made-up Reining 3', kind: 'reining', page: 2, classes: ['Open Reining'], boxes, unsure: '' },
        { name: 'Made-up Level II M', kind: 'horsemanship', page: 3, classes: ['Level II Horsemanship'], boxes, unsure: 'Step 4 was faint' },
        { name: 'Made-up Trail 1', kind: 'other', page: 4, classes: [], boxes, unsure: '' },
      ],
      notes: '',
    }
    render(<SetupScreen showId="s-fall00001" />)
    fireEvent.change(screen.getByLabelText('Pattern book PDF'), { target: { files: [pdf()] } })
    expect(await screen.findByText('Found in the book')).toBeTruthy()
    expect(screen.getByText(/Check this one: Step 4 was faint/)).toBeTruthy()
    // Leave the trail pattern out.
    const trail = screen.getByText('Made-up Trail 1').closest('li')!
    fireEvent.click(within(trail).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Add the ticked patterns' }))
    expect(await screen.findByText(/Added 2 patterns\. 2 classes were given a pattern\./)).toBeTruthy()
    expect(screen.queryByText('Made-up Trail 1')).toBeNull()
    const reining = screen.getAllByDisplayValue('Open Reining').find((el) => el.tagName === 'INPUT')!.closest('li')!
    const select = within(reining).getByLabelText('Pattern') as HTMLSelectElement
    expect(select.options[select.selectedIndex].text).toMatch(/Made-up Reining 3/)
  })

  it('shows what went wrong when the reader fails', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001'))
    render(<SetupScreen showId="s-fall00001" />)
    server.down = true
    fireEvent.change(screen.getByLabelText('Pattern book PDF'), { target: { files: [pdf()] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/))
  })
})
