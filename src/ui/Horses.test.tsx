import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StableHorse } from '../cloud/backend'
import { setBackendForTests, signIn, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCoachForTests } from '../cloud/roster'
import { resetScoreSendingForTests } from '../cloud/scores'
import { clearSeatForTests } from '../cloud/seat'
import { clearCloudCache } from '../data/cloudShows'
import { getClass } from '../data/fixture'
import { clearShows } from '../data/shows'
import { clearDrawBooks, drawBook, saveDrawBook } from '../setup/drawBook'
import { findStable, stableRow, withListLimits } from '../setup/stable'
import { sampleShowWorkbook } from '../setup/testWorkbook'
import { clearAll } from '../store'
import { DrawScreen } from './DrawScreen'
import { HorsesScreen } from './HorsesScreen'

const SATURDAY = 'evt-bhc-2026-11-21'
const SUNDAY = 'evt-bhc-2026-11-22'
const LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit?usp=sharing'
let server: FakeBackend

const horse = (name: string, provider = '', takesHeight = true, maxGroup: 1 | 2 | 3 = 3, byClass: StableHorse['byClass'] = {}): StableHorse => ({ name, provider, takesHeight, maxGroup, byClass })

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  clearSeatForTests()
  clearCoachForTests()
  clearDrawBooks()
  resetScoreSendingForTests()
  localStorage.removeItem('hss.sheetlinks.v1')
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

function addHorses(names: string[]) {
  fireEvent.change(screen.getByLabelText('Add horses, one per line'), { target: { value: names.join('\n') } })
  fireEvent.click(screen.getByRole('button', { name: 'Add horses' }))
}

describe('matching a show’s horses to the horses list', () => {
  const list = [horse('Rocket', 'Example College', false, 2), horse('Rocket', 'Another Barn', true, 1), horse('Dot', '', true, 1), horse('Ace', 'Example College', false, 3)]

  it('goes by name and provider, and by name alone only when that cannot be wrong', () => {
    expect(findStable(list, { name: 'rocket ', provider: 'example college' })).toBe(list[0])
    expect(findStable(list, { name: 'Rocket', provider: 'Another Barn' })).toBe(list[1])
    // Two Rockets and no provider given: it could be either, so neither.
    expect(findStable(list, { name: 'Rocket' })).toBeUndefined()
    // One Ace on the list: a show that does not say the provider still means that Ace.
    expect(findStable(list, { name: 'Ace' })).toBe(list[3])
    // Dot was saved before its provider was known.
    expect(findStable(list, { name: 'Dot', provider: 'Example College' })).toBe(list[2])
    expect(findStable(list, { name: 'Nobody' })).toBeUndefined()
  })

  it('gives a show’s horse the list’s limits, and saves over the row it matched', () => {
    expect(withListLimits(list, { name: 'Ace', takesHeight: true, maxGroup: 1 })).toEqual({ name: 'Ace', takesHeight: false, maxGroup: 3, byClass: {} })
    expect(withListLimits(null, { name: 'Ace', takesHeight: true, maxGroup: 1 })).toEqual({ name: 'Ace', takesHeight: true, maxGroup: 1 })
    expect(stableRow(list, { name: 'Ace', takesHeight: true, maxGroup: 2 })).toEqual(horse('Ace', 'Example College', true, 2))
    // A row saved with no provider gets the provider once the show's sheet names it.
    expect(stableRow(list, { name: 'Dot', provider: 'Example College', takesHeight: true, maxGroup: 2 })).toEqual(horse('Dot', 'Example College', true, 2))
    expect(stableRow(list, { name: 'New One', takesHeight: false, maxGroup: 1 })).toEqual(horse('New One', '', false, 1))
  })
})

describe('the horses list on the server', () => {
  it('takes a show’s horses and their limits, and has them ready for the next show', async () => {
    await asAdmin()
    render(<DrawScreen showId={SATURDAY} />)
    addHorses(['Ace', 'Bo', 'Fig'])
    // Each new horse goes onto the list as it stands: takes height riders, carries any group.
    await waitFor(() => expect(server.horses.map((h) => h.name).sort()).toEqual(['Ace', 'Bo', 'Fig']))
    fireEvent.change(screen.getByLabelText('Heaviest weight group Ace carries'), { target: { value: '1' } })
    // Bo is marked height restricted: no height rider draws Bo.
    fireEvent.click(within(screen.getByLabelText('Heaviest weight group Bo carries').closest('li')!).getByLabelText('Height restricted'))
    await waitFor(() => expect(server.horses.find((h) => h.name === 'Ace')).toEqual(horse('Ace', '', true, 1)))
    await waitFor(() => expect(server.horses.find((h) => h.name === 'Bo')).toEqual(horse('Bo', '', false, 3)))
    cleanup()

    // The next show, on a computer that has never seen these horses: nothing is kept there.
    clearDrawBooks()
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Fig'])
    await waitFor(() => expect((screen.getByLabelText('Heaviest weight group Ace carries') as HTMLSelectElement).value).toBe('1'))
    expect((within(screen.getByLabelText('Heaviest weight group Bo carries').closest('li')!).getByLabelText('Height restricted') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Heaviest weight group Fig carries') as HTMLSelectElement).value).toBe('3')
    // The list was not written over with this computer's blank settings.
    expect(server.horses.find((h) => h.name === 'Ace')).toEqual(horse('Ace', '', true, 1))

    // And the draw uses them: 125 is in weight group 3, so never on Ace, which carries group 1 only.
    server.riders = [{ backNo: '125', rider: 'Paige Johnson', team: 'Example College', height: false, group: 3 }]
    cleanup()
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Gus', 'Hal'])
    await waitFor(() => expect((screen.getByLabelText('Heaviest weight group Ace carries') as HTMLSelectElement).value).toBe('1'))
    await screen.findByRole('button', { name: /Show the 59 riders \(1 marked\)/ })
    // Level I, Sec. B: five riders, five horses, no horse twice.
    const panel = screen.getByRole('region', { name: /Level I Horsemanship, Sec\. B/ })
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    for (let i = 0; i < 10; i++) {
      fireEvent.click(within(panel).getByRole('button', { name: /Draw (for this class|this class again)/ }))
      const entries = getClass('meet-6', '7')!.entries
      expect(new Set(entries.map((e) => e.horse)).size).toBe(5)
      expect(entries.find((e) => e.back_no === '125')!.horse).not.toBe('Ace')
    }
    vi.restoreAllMocks()
  })

  it('takes limits that were set on this computer before the list existed', async () => {
    saveDrawBook(SUNDAY, { horses: [{ name: 'Ace', takesHeight: false, maxGroup: 2 }, { name: 'Bo', takesHeight: true, maxGroup: 3 }], riders: {}, sets: {} })
    // Bo is already on the list with different limits: the list wins for Bo.
    server.horses = [horse('Bo', 'Example College', false, 1)]
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    await waitFor(() => expect(server.horses.find((h) => h.name === 'Ace')).toEqual(horse('Ace', '', false, 2)))
    expect(server.horses.find((h) => h.name === 'Bo')).toEqual(horse('Bo', 'Example College', false, 1))
    expect((screen.getByLabelText('Heaviest weight group Bo carries') as HTMLSelectElement).value).toBe('1')
  })

  it('files horses read from a sheet under who provides them', async () => {
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    fireEvent.change(await screen.findByLabelText(/Or read the horse list/), { target: { value: LINK } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the horses from the sheet' }))
    await waitFor(() => expect(server.horses).toHaveLength(6), { timeout: 5000 })
    expect(server.horses.find((h) => h.name === 'Rocket')).toEqual(horse('Rocket', 'Example College'))
    expect(server.horses.find((h) => h.name === 'Super Pete')).toEqual(horse('Super Pete', 'Sample University'))
    // A horse the sheet gives no provider for is filed with none.
    expect(server.horses.find((h) => h.name === 'Duke & Daisy')).toEqual(horse('Duke & Daisy', ''))
    expect(drawBook(SUNDAY).horses.find((h) => h.name === 'Rocket')!.provider).toBe('Example College')
  })

  it('keeps working from this computer when the list cannot be reached', async () => {
    saveDrawBook(SUNDAY, { horses: [{ name: 'Ace', takesHeight: true, maxGroup: 1 }], riders: {}, sets: {} })
    await asAdmin()
    server.down = true
    render(<DrawScreen showId={SUNDAY} />)
    expect(await screen.findByText(/Could not reach the horses list, so the limits kept on this computer are used\./)).toBeTruthy()
    expect((screen.getByLabelText('Heaviest weight group Ace carries') as HTMLSelectElement).value).toBe('1')
    fireEvent.change(screen.getByLabelText('Heaviest weight group Ace carries'), { target: { value: '2' } })
    expect(drawBook(SUNDAY).horses[0].maxGroup).toBe(2)
    expect(getClass('meet-6', '1')).toBeTruthy()
  })
})

describe('the horses page', () => {
  it('lists every horse by provider and saves a change', async () => {
    server.horses = [horse('Rocket', 'Example College', false, 2), horse('Ace', 'Example College'), horse('Dot', '', true, 1)]
    await asAdmin()
    render(<HorsesScreen />)
    const barn = await screen.findByRole('region', { name: 'Example College' })
    expect(within(barn).getAllByRole('listitem').map((li) => li.querySelector('strong')!.textContent)).toEqual(['Ace', 'Rocket'])
    expect(screen.getByRole('region', { name: 'No provider given' })).toBeTruthy()
    fireEvent.change(within(barn).getByLabelText('Heaviest weight group Rocket carries'), { target: { value: '3' } })
    expect(await screen.findByText('Saved for Rocket.')).toBeTruthy()
    expect(server.horses.find((h) => h.name === 'Rocket')).toEqual(horse('Rocket', 'Example College', false, 3))
  })

  it('is closed to anyone who is not a show admin', async () => {
    server.horses = [horse('Rocket', 'Example College')]
    await startCloud()
    render(<HorsesScreen />)
    expect(screen.getByText(/Only a show admin sees the horses list/)).toBeTruthy()
    expect(screen.queryByText('Rocket')).toBeNull()
    expect(await server.listHorses()).toEqual([])
  })
})

describe('limits that differ from class to class', () => {
  it('a height rider never draws a horse marked height restricted, and the mark can be for one class only', async () => {
    // 662 is a height rider. In Level I she rides in section B.
    server.riders = [{ backNo: '662', rider: 'Korah Pinter', team: 'Example College', height: true, group: 1 }]
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Cy', 'Dot', 'Eli'])
    await waitFor(() => expect(server.horses).toHaveLength(5))
    // Nothing is restricted to begin with.
    for (const name of ['Ace', 'Bo', 'Cy', 'Dot', 'Eli']) {
      expect((within(screen.getByLabelText(`Heaviest weight group ${name} carries`).closest('li')!).getByLabelText('Height restricted') as HTMLInputElement).checked).toBe(false)
    }

    const panel = screen.getByRole('region', { name: /Level I Horsemanship, Sec\. B/ })
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Height and weight limits for this class (0 changed)' }))
    expect(within(panel).getByText(/Change a horse's limits for every section of Level I Horsemanship only\./)).toBeTruthy()
    // For Level I only, every horse but Eli is height restricted.
    for (const name of ['Ace', 'Bo', 'Cy', 'Dot']) fireEvent.click(within(panel).getByLabelText(`${name} is height restricted in Level I Horsemanship, Sec. B`))
    await waitFor(() => expect(server.horses.find((h) => h.name === 'Dot')!.byClass).toEqual({ '13': { takesHeight: false, maxGroup: 3 } }))
    // The horse's usual limits are untouched.
    expect(server.horses.find((h) => h.name === 'Dot')).toMatchObject({ takesHeight: true, maxGroup: 3 })
    expect((within(screen.getAllByLabelText('Heaviest weight group Dot carries')[0].closest('li')!).getByLabelText('Height restricted') as HTMLInputElement).checked).toBe(false)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    for (let i = 0; i < 12; i++) {
      fireEvent.click(within(panel).getByRole('button', { name: /Draw (for this class|this class again)/ }))
      expect(getClass('meet-6', '7')!.entries.find((e) => e.back_no === '662')!.horse).toBe('Eli')
    }

    // The other section of Level I shares the setting. Reining does not.
    const sectionA = screen.getByRole('region', { name: /Level I Horsemanship, Sec\. A/ })
    fireEvent.click(within(sectionA).getByRole('button', { name: 'Pick all' }))
    expect(within(sectionA).getByRole('button', { name: 'Height and weight limits for this class (4 changed)' })).toBeTruthy()
    const reining = screen.getByRole('region', { name: 'Reining, Sunday' })
    fireEvent.click(within(reining).getByRole('button', { name: 'Pick all' }))
    expect(within(reining).getByRole('button', { name: 'Height and weight limits for this class (0 changed)' })).toBeTruthy()

    // Setting a class back to the usual limits stops it being a special case.
    fireEvent.click(within(panel).getByRole('button', { name: 'Use the usual limits for Dot in Level I Horsemanship, Sec. B' }))
    await waitFor(() => expect(server.horses.find((h) => h.name === 'Dot')!.byClass).toEqual({}))
    vi.restoreAllMocks()
  })

  it('a weight limit for one class keeps a heavier rider off that horse in that class only', async () => {
    // 125 is in weight group 3 and rides in Level I, Sec. B.
    server.riders = [{ backNo: '125', rider: 'Paige Johnson', team: 'Example College', height: false, group: 3 }]
    // Fig usually carries any rider, but only group 1 in Level I. The others carry group 2 everywhere but one.
    server.horses = [horse('Ace', '', true, 2), horse('Bo', '', true, 2), horse('Cy', '', true, 2), horse('Dot', '', true, 2), horse('Eli', '', true, 3), horse('Fig', '', true, 3, { '13': { takesHeight: true, maxGroup: 1 } })]
    await asAdmin()
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Cy', 'Dot', 'Eli', 'Fig'])
    await waitFor(() => expect((screen.getByLabelText('Heaviest weight group Ace carries') as HTMLSelectElement).value).toBe('2'))
    await screen.findByRole('button', { name: /Show the 59 riders \(1 marked\)/ })
    const panel = screen.getByRole('region', { name: /Level I Horsemanship, Sec\. B/ })
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Height and weight limits for this class (1 changed)' }))
    expect((within(panel).getByLabelText('Heaviest weight group Fig carries in Level I Horsemanship, Sec. B') as HTMLSelectElement).value).toBe('1')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    for (let i = 0; i < 12; i++) {
      fireEvent.click(within(panel).getByRole('button', { name: /Draw (for this class|this class again)/ }))
      // In Level I only Eli carries group 3.
      expect(getClass('meet-6', '7')!.entries.find((e) => e.back_no === '125')!.horse).toBe('Eli')
    }
    vi.restoreAllMocks()
  })
})
