import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publishShow, setBackendForTests, signIn, signOut, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCloudCache } from '../data/cloudShows'
import { findPattern, getShow, isSample, type ShowFile } from '../data/fixture'
import { clearShows, saveShow, userShows } from '../data/shows'
import { setPageRendererForTests } from '../setup/pdfPages'
import { sampleShowWorkbook } from '../setup/testWorkbook'
import { resultsCsv } from '../results'
import { clearAll, getState } from '../store'
import { AccountScreen } from './AccountScreen'
import { ClassScreen } from './ClassScreen'
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
/** The pages of the pattern book the app asked to have turned into pictures. */
let renderedPages: number[]

beforeEach(() => {
  renderedPages = []
  // Tests have no canvas to draw a PDF page on. Stand in for the renderer.
  setPageRendererForTests(async (_pdf, page) => {
    renderedPages.push(page)
    if (page > 14) throw new Error(`The pattern book has 14 pages. There is no page ${page}.`)
    return new Blob([`picture of page ${page}`], { type: 'image/jpeg' })
  })
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
    expect(screen.getByRole('button', { name: /IHSA Western Show, November 21/ })).toBeTruthy()
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

describe('the picture of the pattern on the class screen', () => {
  function withPicture(path: string): ShowFile {
    const s = show('s-fall00001', 'p-fall-1')
    s.patterns[0].page_image = path
    return s
  }

  it('shows the pattern book page under the written maneuvers, on a phone that is not signed in', async () => {
    server.shows = [withPicture('pages/pg-abc123def4.jpg')]
    await startCloud()
    render(<ClassScreen meetId="s-fall00001-m1" classId="1" />)
    expect(screen.queryByRole('img', { name: /Pattern book page/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Made-up pattern/ }))
    const picture = screen.getByRole('img', { name: 'Pattern book page for Made-up pattern' }) as HTMLImageElement
    expect(picture.src).toBe('https://fake.example/storage/v1/object/public/pattern-pages/pages/pg-abc123def4.jpg')
    // If it cannot be fetched, the screen says so and the written maneuvers stay.
    fireEvent.error(picture)
    expect(screen.getByText(/did not load/)).toBeTruthy()
    expect(screen.getByText('Maneuver 1')).toBeTruthy()
  })

  it('never loads a picture from an address the app did not make', async () => {
    for (const bad of ['https://evil.example/track.png', '../../auth/v1/user', 'pages/../x.jpg', 'pages/x.svg']) {
      server.shows = [withPicture(bad)]
      setBackendForTests(server)
      await startCloud()
      render(<ClassScreen meetId="s-fall00001-m1" classId="1" />)
      fireEvent.click(screen.getByRole('button', { name: /Made-up pattern/ }))
      expect(screen.queryByRole('img')).toBeNull()
      cleanup()
    }
  })
})

describe('turning a sample show into the real, published show', () => {
  const SUNDAY = 'evt-bhc-2026-11-22'

  it('is not offered to a phone that is not signed in', async () => {
    await startCloud()
    render(<ShowScreen showId={SUNDAY} />)
    expect(screen.queryByRole('button', { name: 'Change the setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull()
  })

  it('a show admin adds the pattern book pictures, saves and publishes, and it takes the sample\'s place', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    render(<ShowScreen showId={SUNDAY} />)
    expect(screen.getByRole('button', { name: 'Change the setup' })).toBeTruthy()
    cleanup()

    render(<SetupScreen showId={SUNDAY} />)
    // The sample's patterns know their pages of the book, so one file gives every picture.
    expect(screen.getByRole('button', { name: 'Add the pattern book pictures (6 patterns)' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Pattern book for the pictures'), {
      target: { files: [new File([new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer as ArrayBuffer], 'book.pdf', { type: 'application/pdf' })] },
    })
    expect(await screen.findByText(/Saved 6 pictures/)).toBeTruthy()
    expect(renderedPages).toEqual([9, 10, 11, 12, 13, 14])
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    cleanup()

    // Saved here: a working copy stands in front of the sample, with the same days and classes.
    expect(isSample(SUNDAY)).toBe(false)
    const copy = getShow(SUNDAY)!
    expect(copy.meets.map((m) => m.id)).toEqual(['meet-6'])
    expect(copy.patterns.every((p) => /^pages\/pg-/.test(p.page_image ?? ''))).toBe(true)
    expect(findPattern('nrha-8')?.page_image).toBe(copy.patterns.find((p) => p.id === 'nrha-8')?.page_image)

    expect(await publishShow(copy)).toBeNull()
    expect(server.shows.map((s) => s.id)).toEqual([SUNDAY])
    expect(userShows()).toHaveLength(0)
    expect(getShow(SUNDAY)?.patterns[0].page_image).toMatch(/^pages\/pg-/)
    render(<Home />)
    // One Sunday show in the list, no longer marked as a sample. Saturday still is.
    const sunday = screen.getAllByRole('button', { name: /IHSA Western Show, November 22/ })
    expect(sunday).toHaveLength(1)
    expect(sunday[0].textContent).not.toMatch(/Sample/)
    expect(screen.getByRole('button', { name: /November 21.*Sample that comes with the app/ })).toBeTruthy()
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
    expect(await screen.findByText(/Added 2 patterns\. Saved 2 pictures of the book's pages\. 2 classes were given a pattern\./)).toBeTruthy()
    expect(screen.queryByText('Made-up Trail 1')).toBeNull()
    // A picture of each added pattern's page went to the server. The page left out was not drawn.
    expect(renderedPages).toEqual([2, 3])
    expect(Object.keys(server.pages)).toHaveLength(2)
    expect(screen.getByText(/with a picture of page 2/)).toBeTruthy()
    const reining = screen.getAllByDisplayValue('Open Reining').find((el) => el.tagName === 'INPUT')!.closest('li')!
    const select = within(reining).getByLabelText('Pattern') as HTMLSelectElement
    expect(select.options[select.selectedIndex].text).toMatch(/Made-up Reining 3/)
  })

  it('uses the page number a person corrects, and still adds the pattern when a picture cannot be made', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001'))
    const boxes = [{ code: 'W', words: 'Walk' }]
    server.reader = {
      patterns: [
        { name: 'Made-up Reining 3', kind: 'reining', page: 2, classes: [], boxes, unsure: '' },
        { name: 'Made-up Level II M', kind: 'horsemanship', page: 99, classes: [], boxes, unsure: '' },
      ],
      notes: '',
    }
    render(<SetupScreen showId="s-fall00001" />)
    fireEvent.change(screen.getByLabelText('Pattern book PDF'), { target: { files: [pdf()] } })
    fireEvent.change(await screen.findByLabelText('Page of the book for Made-up Reining 3'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add the ticked patterns' }))
    expect(await screen.findByText(/Added 2 patterns\. Saved 1 picture of the book's pages\. Some pictures could not be saved: The pattern book has 14 pages/)).toBeTruthy()
    expect(renderedPages).toEqual([5, 99])
    expect(screen.getByText('Made-up Level II M')).toBeTruthy()
  })

  it('a pattern typed by hand can be given its page of the book, and the picture can be taken away', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-fall00001', 'p-fall-1'))
    render(<SetupScreen showId="s-fall00001" />)
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByLabelText('Page of the book'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Pattern book for the picture'), { target: { files: [pdf()] } })
    expect(await screen.findByRole('img', { name: /Pattern book page for Made-up pattern/ })).toBeTruthy()
    expect(renderedPages).toEqual([7])
    // The book is kept for this visit, so the next change needs no file.
    fireEvent.change(screen.getByLabelText('Page of the book'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this page' }))
    await waitFor(() => expect(renderedPages).toEqual([7, 8]))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the picture' }))
    expect(screen.queryByRole('img', { name: /Pattern book page/ })).toBeNull()
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
