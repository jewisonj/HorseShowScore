import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { RosterRider } from '../cloud/backend'
import { publishShow, setBackendForTests, signIn, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCoachForTests, currentCoach, mergeRoster } from '../cloud/roster'
import { resetScoreSendingForTests } from '../cloud/scores'
import { clearSeatForTests } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import { getClass, getShow } from '../data/fixture'
import { clearShows } from '../data/shows'
import { clearDrawBooks, drawBook, saveDrawBook } from '../setup/drawBook'
import { sampleShowWorkbook } from '../setup/testWorkbook'
import { readRoster } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { clearAll } from '../store'
import { DrawScreen } from './DrawScreen'
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
