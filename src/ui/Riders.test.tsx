import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { RosterRider } from '../cloud/backend'
import { publishShow, setBackendForTests, signIn, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCoachForTests, currentCoach, mergeRoster } from '../cloud/roster'
import { resetScoreSendingForTests } from '../cloud/scores'
import { clearSeatForTests } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import { classKey, getClass, getShow, type ShowFile } from '../data/fixture'
import { clearShows } from '../data/shows'
import { clearDrawBooks, drawBook, saveDrawBook } from '../setup/drawBook'
import { drawCsv } from '../setup/drawExport'
import { makeXlsx, sampleShowWorkbook } from '../setup/testWorkbook'
import { lastSheetLink, rememberSheetLink, sheetLinkFor } from '../setup/sheetLink'
import { readRoster } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { loadDraw } from '../seed'
import { classState, clearAll, getState } from '../store'
import { DrawScreen } from './DrawScreen'
import { showForToday } from './DrawSheet'
import { RidersScreen } from './RidersScreen'

const SUNDAY = 'evt-bhc-2026-11-22'
let server: FakeBackend

const rider = (backNo: string, name: string, team: string, height = false, group: 1 | 2 | 3 = 1): RosterRider => ({ backNo, rider: name, team, height, group })

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  clearSeatForTests()
  clearCoachForTests()
  clearDrawBooks()
  resetScoreSendingForTests()
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.workbook = sampleShowWorkbook()
  setBackendForTests(server)
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

async function asAdmin() {
  await startCloud()
  await signIn('admin@example.com', 'right')
}

describe('the riders list', () => {
  it('reads back number, rider and school from the sheet’s Exhibitors tab', () => {
    expect(readRoster(readXlsx(sampleShowWorkbook()))).toEqual([
      { backNo: '501', rider: 'Ada Able', team: 'Example College' },
      { backNo: '502', rider: 'Ben Baker', team: 'Example College' },
      { backNo: '503', rider: 'Cy Cole', team: 'Sample University' },
      { backNo: '504', rider: 'Di Dunn', team: 'Sample University' },
      { backNo: '505', rider: 'Eve Ely', team: 'Sample University' },
    ])
  })

  it('keeps a rider’s marks when the sheet is read again, and clears them when the number has a new name', () => {
    const have = [rider('501', 'Ada Able', 'Example College', true, 2), rider('502', 'Ben Baker', 'Example College', false, 3), rider('900', 'Old Timer', 'Example College', true, 3)]
    const merged = mergeRoster(have, [
      { backNo: '501', rider: 'ada  able', team: 'Example College' },
      { backNo: '502', rider: 'Someone Else', team: 'Sample University' },
      { backNo: '503', rider: 'Cy Cole', team: 'Sample University' },
    ])
    // 501 is the same person, spelled a little differently: the marks stay and the spelling follows the sheet.
    expect(merged.rows.find((r) => r.backNo === '501')).toEqual(rider('501', 'ada able', 'Example College', true, 2))
    // 502 belongs to someone else now: their marks start again.
    expect(merged.rows.find((r) => r.backNo === '502')).toEqual(rider('502', 'Someone Else', 'Sample University'))
    expect(merged.rows.find((r) => r.backNo === '503')).toEqual(rider('503', 'Cy Cole', 'Sample University'))
    // A rider the sheet does not mention is not touched.
    expect(merged.rows.some((r) => r.backNo === '900')).toBe(false)
    expect([merged.added, merged.changed, merged.reset]).toEqual([1, 2, 1])
  })

  it('is filled from the sheet by a show admin, who marks riders and gives each team a coach PIN', async () => {
    await asAdmin()
    render(<RidersScreen />)
    expect(await screen.findByText('No riders yet. Read them from a show\'s sheet.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Read the riders from a show's Google Sheet"), { target: { value: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit?usp=sharing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the riders from the sheet' }))
    expect((await screen.findByRole('status', {}, { timeout: 5000 })).textContent).toBe('The sheet lists 5 riders. 5 added, 0 changed. The sheet was only read. Nothing in it was changed.')
    expect(server.riders).toHaveLength(5)
    expect(server.teams.map((t) => t.team).sort()).toEqual(['Example College', 'Sample University'])

    const team = screen.getByRole('region', { name: 'Sample University' })
    expect(within(team).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.change(within(team).getByLabelText('Weight group of 504'), { target: { value: '3' } })
    await waitFor(() => expect(server.riders.find((r) => r.backNo === '504')).toMatchObject({ height: false, group: 3 }))
    fireEvent.click(within(within(team).getByLabelText('Weight group of 503').closest('li')!).getByLabelText('Height rider'))
    await waitFor(() => expect(server.riders.find((r) => r.backNo === '503')).toMatchObject({ height: true, group: 1 }))

    expect(within(team).getByText('none yet')).toBeTruthy()
    fireEvent.click(within(team).getByRole('button', { name: 'Make a new coach PIN for Sample University' }))
    await waitFor(() => expect(server.teams.find((t) => t.team === 'Sample University')!.pin).toMatch(/^\d{6}$/))
    expect(server.teams.find((t) => t.team === 'Example College')!.pin).toBeNull()
  })

  it('is closed to anyone who is not a show admin', async () => {
    server.riders = [rider('501', 'Ada Able', 'Example College', true, 2)]
    await startCloud()
    render(<RidersScreen />)
    expect(screen.getByText(/Only a show admin sees the riders list/)).toBeTruthy()
    expect(screen.queryByText('Ada Able')).toBeNull()
    expect(await server.listRiders()).toEqual([])
  })
})

describe('a coach', () => {
  beforeEach(() => {
    server.riders = [rider('501', 'Ada Able', 'Example College'), rider('502', 'Ben Baker', 'Example College', true, 2), rider('503', 'Cy Cole', 'Sample University', false, 3)]
    server.teams = [
      { team: 'Example College', pin: '700001' },
      { team: 'Sample University', pin: '700002' },
    ]
  })

  async function coachSignsOn(pin: string) {
    window.location.hash = ''
    await startCloud()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^Coach/ }))
    fireEvent.change(await screen.findByLabelText('Coach PIN'), { target: { value: pin } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign on' }))
  }

  it('signs on with the team’s PIN and sees only their own riders', async () => {
    await coachSignsOn('700001')
    expect(await screen.findByRole('heading', { name: 'Example College' })).toBeTruthy()
    expect(screen.getByText('Ada Able')).toBeTruthy()
    expect(screen.getByText('Ben Baker')).toBeTruthy()
    expect(screen.queryByText('Cy Cole')).toBeNull()
    expect(currentCoach()).toEqual({ team: 'Example College', pin: '700001' })
    // Ben is already marked as the admin left him.
    expect((screen.getByLabelText('Weight group of 502') as HTMLSelectElement).value).toBe('2')
    // Nothing else of the app is on this screen.
    expect(screen.queryByRole('button', { name: /Publish|Set up|Draw|Judges and PINs/ })).toBeNull()
  })

  it('marks a rider, and the riders list holds it', async () => {
    await coachSignsOn('700001')
    fireEvent.change(await screen.findByLabelText('Weight group of 501'), { target: { value: '3' } })
    expect(await screen.findByText('Saved for 501.')).toBeTruthy()
    expect(server.riders.find((r) => r.backNo === '501')).toMatchObject({ group: 3, height: false })
    fireEvent.click(within(screen.getByLabelText('Weight group of 501').closest('li')!).getByLabelText('Height rider'))
    await waitFor(() => expect(server.riders.find((r) => r.backNo === '501')).toMatchObject({ group: 3, height: true }))
  })

  it('cannot mark another team’s rider, even by asking the server directly', async () => {
    expect(await server.coachSetMark('700001', '503', true, 1)).toBe('not_yours')
    expect(await server.coachSetMark('999999', '501', true, 1)).toBe('wrong_pin')
    expect(await server.coachRiders('')).toBeNull()
    expect(server.riders.find((r) => r.backNo === '503')).toMatchObject({ height: false, group: 3 })
  })

  it('is told when the PIN is wrong, and can sign off', async () => {
    await coachSignsOn('123456')
    expect((await screen.findByRole('alert')).textContent).toBe('That PIN is not a coach PIN.')
    expect(currentCoach()).toBeNull()
    fireEvent.change(screen.getByLabelText('Coach PIN'), { target: { value: '700002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign on' }))
    expect(await screen.findByRole('heading', { name: 'Sample University' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign off' }))
    expect(currentCoach()).toBeNull()
    expect(await screen.findByRole('button', { name: /^Coach/ })).toBeTruthy()
  })
})

describe('a coach looking over the draw', () => {
  beforeEach(() => {
    // 662 rides in Sunday's show. She is on the coach's team.
    server.riders = [rider('662', 'Korah Pinter', 'Example College'), rider('503', 'Cy Cole', 'Sample University')]
    server.teams = [{ team: 'Example College', pin: '700001' }]
  })

  it('sees each class as a table like the sheet’s, with their own riders marked and the alternates underneath', async () => {
    const sunday = JSON.parse(JSON.stringify(getShow(SUNDAY)!)) as ShowFile
    const level1 = sunday.meets[0].classes.find((c) => c.entries.some((e) => e.back_no === '662'))!
    level1.entries = level1.entries.map((e, i) => ({ ...e, horse: `Horse ${i + 1}` }))
    level1.alternates = ['Spare One', 'Spare Two']
    server.shows = [sunday]
    await startCloud()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^Coach/ }))
    fireEvent.change(await screen.findByLabelText('Coach PIN'), { target: { value: '700001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign on' }))
    fireEvent.click(await screen.findByRole('button', { name: 'See the draw' }))

    expect(await screen.findByRole('heading', { name: 'The draw' })).toBeTruthy()
    // One table for each class of the show.
    expect(screen.getAllByRole('table')).toHaveLength(sunday.meets[0].classes.length)
    const table = screen.getByRole('table', { name: new RegExp(`^${level1.id}\\. ${level1.name.replace(/[.]/g, '\\.')}`) })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Draw', 'Back #', 'Rider', 'Horse'])
    // Riders in draw order, each with a horse.
    const rows = within(table).getAllByRole('row').slice(1)
    const sorted = [...level1.entries].sort((a, b) => a.draw - b.draw)
    expect(rows.slice(0, sorted.length).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent!.replace(' (your rider)', '')))).toEqual(sorted.map((e) => [String(e.draw), e.back_no, e.rider, e.horse]))
    // The alternates come last.
    expect(rows.slice(sorted.length).map((r) => r.textContent)).toEqual(['AlternateSpare One', 'AlternateSpare Two'])
    // The coach's rider is marked, and only hers.
    const hers = await waitFor(() => {
      const row = rows.find((r) => r.className === 'sheet-draw-mine')
      expect(row).toBeTruthy()
      return row!
    })
    expect(hers.textContent).toContain('662')
    expect(rows.filter((r) => r.className === 'sheet-draw-mine')).toHaveLength(1)
    expect(screen.getByText(/Your riders are marked/)).toBeTruthy()
    // Nothing of the marks or the limits is on this page.
    expect(screen.queryByText(/weight group|height/i)).toBeNull()
    // And back to the riders.
    fireEvent.click(screen.getByRole('button', { name: /My riders/ }))
    expect(await screen.findByRole('heading', { name: 'Example College' })).toBeTruthy()
  })

  it('opens today’s show, else the next one coming, else the newest', () => {
    const show = (id: string, date: string) => ({ ...getShow(SUNDAY)!, id, meets: [{ ...getShow(SUNDAY)!.meets[0], date }] })
    const list = [show('a', '2026-11-21'), show('b', '2026-11-22'), show('c', '2027-02-06')]
    expect(showForToday(list, '2026-11-22')!.id).toBe('b')
    expect(showForToday(list, '2026-12-01')!.id).toBe('c')
    expect(showForToday(list, '2027-03-01')!.id).toBe('c')
    expect(showForToday([], '2026-11-22')).toBeUndefined()
  })

  it('is sent to the sign-on when not signed on as a coach', async () => {
    window.location.hash = '#/coach/draw'
    await startCloud()
    render(<App />)
    expect(await screen.findByLabelText('Coach PIN')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('the draw page with the riders list', () => {
  it('draws from the marks on the riders list, saves new marks there, and publishes none of it', async () => {
    // 125 is in weight group 3 on the server's list. Nothing about them is on this computer.
    server.riders = [rider('125', 'Paige Johnson', 'Example College', false, 3)]
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    fireEvent.change(screen.getByLabelText('Add horses, one per line'), { target: { value: 'Ace\nBo\nCy\nDot\nEli\nFig' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add horses' }))
    for (const name of ['Ace', 'Bo', 'Cy', 'Dot', 'Eli']) fireEvent.change(screen.getByLabelText(`Heaviest weight group ${name} carries`), { target: { value: '2' } })
    expect(await screen.findByRole('button', { name: /Show the 59 riders \(1 marked\)/ })).toBeTruthy()

    // Level I, Sec. B: only Fig carries group 3, so 125 always draws Fig.
    const panel = screen.getByRole('region', { name: /Level I Horsemanship, Sec\. B/ })
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    expect(getClass('meet-6', '7')!.entries.find((e) => e.back_no === '125')!.horse).toBe('Fig')

    // A mark made here goes to the riders list, not into this computer's draw book.
    fireEvent.click(screen.getByRole('button', { name: /Show the 59 riders/ }))
    fireEvent.change(screen.getByLabelText('Weight group of 662'), { target: { value: '2' } })
    await waitFor(() => expect(server.riders.find((r) => r.backNo === '662')).toMatchObject({ rider: 'Korah Pinter', height: false, group: 2 }))
    expect(drawBook(SUNDAY).riders).toEqual({})

    // Publishing sends the horses and nothing about height riders or weight groups.
    expect(await publishShow(getShow(SUNDAY)!)).toBeNull()
    const published = JSON.stringify(server.shows)
    expect(published).toContain('"horse":"Fig"')
    for (const word of ['height', 'group', 'takesHeight', 'maxGroup', 'Example College']) expect(published).not.toContain(word)
  })

  it('moves marks made on this computer earlier onto the riders list', async () => {
    saveDrawBook(SUNDAY, { horses: [], riders: { '125': { height: true, group: 3 }, '662': { height: false, group: 1 } }, sets: {} })
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move the 1 mark kept on this computer to the riders list' }))
    await waitFor(() => expect(server.riders).toEqual([rider('125', 'Paige Johnson', '', true, 3)]))
    expect(drawBook(SUNDAY).riders).toEqual({})
    expect(await screen.findByText('1 mark moved to the riders list.')).toBeTruthy()
  })
})

describe('the draw page with a sheet that already has the horses for a class', () => {
  const LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit?usp=sharing'

  beforeEach(() => {
    // Reining is class 1: five draw places, George in two of them, and two alternates. Class 2 has nothing yet.
    server.workbook = makeXlsx({
      Draw: { A4: 1, D6: 'BUNNY', D7: 'GEORGE', D8: 'CISCO', D9: 'REY', D10: 'GEORGE', D18: 'KASH', D19: 'HANK', G4: 2 },
      'Horse Points': { C3: 'Bunny', C4: 'George', C5: 'Cisco', C6: 'Rey', C7: 'Kash', C8: 'Hank', C9: 'Extra' },
    })
  })

  afterEach(() => vi.restoreAllMocks())

  async function readTheSheet() {
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    fireEvent.change(await screen.findByLabelText(/Or read the horse list/), { target: { value: LINK } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the horses from the sheet' }))
    expect(await screen.findByText(/It sets the horses for 1 class, which now use the sheet's list\./, {}, { timeout: 5000 })).toBeTruthy()
  }

  it('takes each class’s horses from the sheet, draws the riders onto them, and gives the columns back', async () => {
    await readTheSheet()
    expect(drawBook(SUNDAY).horses.map((h) => h.name)).toEqual(['Bunny', 'George', 'Cisco', 'Rey', 'Kash', 'Hank', 'Extra'])
    const panel = screen.getByRole('region', { name: 'Reining, Sunday' })
    expect(within(panel).getByText('1 Bunny, 2 George, 3 Cisco, 4 Rey, 5 George')).toBeTruthy()
    expect(within(panel).getByText('Alternates on the sheet: Kash, Hank')).toBeTruthy()
    // The judge's list has the sheet's alternates before anyone draws.
    expect(getClass('meet-6', '1')!.alternates).toEqual(['Kash', 'Hank'])

    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    const cls = getClass('meet-6', '1')!
    // Five riders, five places, each rider on the horse the sheet has in that place.
    expect(cls.entries.map((e) => e.draw).sort()).toEqual([1, 2, 3, 4, 5])
    const sheetOrder = ['Bunny', 'George', 'Cisco', 'Rey', 'George']
    for (const e of cls.entries) expect(e.horse).toBe(sheetOrder[e.draw - 1])
    expect(cls.alternates).toEqual(['Kash', 'Hank'])

    // The back numbers, one line per draw place, to paste beside the sheet's horses.
    const byPlace = [...cls.entries].sort((a, b) => a.draw - b.draw).map((e) => e.back_no)
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy the back numbers' }))
    const box = (await within(panel).findByLabelText('Lines to paste for Reining')) as HTMLTextAreaElement
    expect(box.value.split('\n')).toEqual([...byPlace, '', '', '', '', '', '', ''])
    expect(within(panel).getByRole('status').textContent).toBe("This device would not copy by itself. Select the lines below and copy them. On the sheet's draw tab, click B6 and paste. Paste as values only.")

    // Where the device can copy, it does, and says where to paste.
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy the horses' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(['BUNNY', 'GEORGE', 'CISCO', 'REY', 'GEORGE', '', '', '', '', '', '', ''].join('\n')))
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toBe("The horses are copied. On the sheet's draw tab, click D6 and paste. Paste as values only."))
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy the alternates' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(['KASH', 'HANK', '', '', ''].join('\n')))
    vi.unstubAllGlobals()

    // The CSV carries the same columns for the whole show.
    const csv = drawCsv(getShow(SUNDAY)!).split('\n')
    expect(csv[1].startsWith('Paste at,B6,D6,H6,J6,N6,P6,B26,D26')).toBe(true)
    expect(csv[2].startsWith(`1,${byPlace[0]},BUNNY,`)).toBe(true)

    // A phone that already had the riders in program order now lists them in the order they drew.
    loadDraw()
    expect(classState(getState(), classKey('meet-6', '1')).runs.map((r) => r.backNo)).toEqual(byPlace)
  })

  it('draws again for one rider only onto a place nobody holds', async () => {
    await readTheSheet()
    const panel = screen.getByRole('region', { name: 'Reining, Sunday' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    const first = getClass('meet-6', '1')!.entries[0]
    fireEvent.click(within(panel).getByRole('button', { name: `Draw again for ${first.back_no}` }))
    // Every place is held, so there is nothing to draw. Nobody else is moved.
    expect(within(panel).getByRole('status').textContent).toBe(`There is no free horse on the sheet's list for ${first.back_no}. Give them a horse by hand.`)
    expect(getClass('meet-6', '1')!.entries[0]).toEqual(first)
    // An alternate can still be given by hand.
    fireEvent.change(within(panel).getByLabelText(`Horse for ${first.back_no}`), { target: { value: 'Kash' } })
    expect(getClass('meet-6', '1')!.entries[0].horse).toBe('Kash')
    expect(getClass('meet-6', '1')!.alternates).toEqual(['Kash', 'Hank'])
  })

  it('goes back to picking the horses here when asked', async () => {
    await readTheSheet()
    const panel = screen.getByRole('region', { name: 'Reining, Sunday' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick the horses here instead' }))
    expect(within(panel).queryByText(/The sheet sets this class's horses/)).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Pick the least used' })).toBeTruthy()
    // The horses the sheet had for it are still picked.
    expect(drawBook(SUNDAY).sets[classKey('meet-6', '1')]).toEqual(['Bunny', 'George', 'Cisco', 'Rey'])
  })
})

describe('the sheet a show was read from', () => {
  const LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit?usp=sharing'
  const OTHER = 'https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxwvuts/edit'

  beforeEach(() => {
    localStorage.removeItem('hss.sheetlinks.v1')
  })

  it('is remembered for the riders page, so the link is not pasted again', async () => {
    // Show setup read Saturday's sheet, then Sunday's.
    rememberSheetLink('evt-bhc-2026-11-21', OTHER)
    rememberSheetLink(SUNDAY, LINK)
    expect(lastSheetLink()).toBe(LINK)
    await asAdmin()
    render(<RidersScreen />)
    await screen.findByText(/No riders yet/)
    // The link used last is already in the box, and each show's sheet is one press away.
    const box = screen.getByLabelText("Read the riders from a show's Google Sheet") as HTMLInputElement
    expect(box.value).toBe(LINK)
    fireEvent.click(screen.getByRole('button', { name: 'Use the sheet of IHSA Western Show, November 21' }))
    expect(box.value).toBe(OTHER)
    fireEvent.click(screen.getByRole('button', { name: 'Use the sheet of IHSA Western Show, November 22' }))
    expect(box.value).toBe(LINK)
    fireEvent.click(screen.getByRole('button', { name: 'Read the riders from the sheet' }))
    expect((await screen.findByRole('status', {}, { timeout: 5000 })).textContent).toContain('The sheet lists 5 riders.')
    expect(server.workbookLinks).toEqual([LINK])
  })

  it('is already filled in on that show’s draw page, and a read there is remembered too', async () => {
    rememberSheetLink(SUNDAY, LINK)
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    const box = (await screen.findByLabelText(/Or read the horse list.*This is the link the show was read from\./)) as HTMLInputElement
    expect(box.value).toBe(LINK)
    cleanup()
    // Saturday's show was never read from a sheet on this computer: its box is empty until a link is used there.
    render(<DrawScreen showId="evt-bhc-2026-11-21" />)
    const empty = (await screen.findByLabelText(/Or read the horse list/)) as HTMLInputElement
    expect(empty.value).toBe('')
    fireEvent.change(empty, { target: { value: OTHER } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the horses from the sheet' }))
    await waitFor(() => expect(sheetLinkFor('evt-bhc-2026-11-21')).toBe(OTHER), { timeout: 5000 })
    expect(sheetLinkFor(SUNDAY)).toBe(LINK)
  })
})
