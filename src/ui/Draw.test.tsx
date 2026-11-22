import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classKey, getClass } from '../data/fixture'
import { clearShows, userShows } from '../data/shows'
import { loadDraw } from '../seed'
import { clearDrawBooks, drawBook } from '../setup/drawBook'
import { classState, clearAll, getState } from '../store'
import { ClassScreen } from './ClassScreen'
import { DrawScreen } from './DrawScreen'

const SUNDAY = 'evt-bhc-2026-11-22'
const NINE = ['Ace', 'Bo', 'Cy', 'Dot', 'Eli', 'Fig', 'Gus', 'Hal', 'Ivy']

beforeEach(() => {
  clearAll()
  clearShows()
  clearDrawBooks()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function addHorses(names: string[]) {
  fireEvent.change(screen.getByLabelText('Add horses, one per line'), { target: { value: names.join('\n') } })
  fireEvent.click(screen.getByRole('button', { name: 'Add horses' }))
}

function classPanel(name: RegExp) {
  return screen.getByRole('region', { name })
}

describe('the horse draw in setup', () => {
  it('draws a rail class: every rider a different horse, the rest alternates, saved in the show', () => {
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(NINE)
    expect(drawBook(SUNDAY).horses.map((h) => h.name)).toEqual(NINE)

    // Class 2 is Rookie B, Sec. A: seven riders on the rail together.
    const panel = classPanel(/Rookie B Horsemanship, Sec\. A/)
    expect(within(panel).getByText(/7 riders\. No horse goes twice\./)).toBeTruthy()
    // Nothing picked yet: the draw asks for the horses first.
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    expect(within(panel).getByRole('status').textContent).toBe('Pick the horses for this class first.')

    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    expect(within(panel).getByRole('status').textContent).toBe('Drawn. 7 riders have a horse, 2 left as alternates.')

    const cls = getClass('meet-6', '2')!
    const horses = cls.entries.map((e) => e.horse)
    expect(horses.every((h) => NINE.includes(h))).toBe(true)
    expect(new Set(horses).size).toBe(7)
    expect(cls.alternates).toHaveLength(2)
    expect([...horses, ...cls.alternates!].sort()).toEqual([...NINE].sort())
    // It is a copy of the show on this computer now, ready to publish.
    expect(userShows().map((s) => s.id)).toEqual([SUNDAY])
    // Scores on this device follow the draw.
    expect(classState(getState(), classKey('meet-6', '2')).runs.map((r) => r.horse)).toEqual(horses)
    expect(within(panel).getByText('Alternates:').parentElement!.textContent).toBe(`Alternates: ${cls.alternates!.join(', ')}`)
  })

  it('lets a horse go again in reining, where riders go one at a time', () => {
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Cy'])
    const panel = classPanel(/^1\. Reining|Reining, Sunday/)
    expect(within(panel).getByText(/5 riders\. A horse may go again\./)).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    const horses = getClass('meet-6', '1')!.entries.map((e) => e.horse)
    expect(horses.every((h) => ['Ace', 'Bo', 'Cy'].includes(h))).toBe(true)
    // Five riders on three horses: every horse goes, none more than twice.
    const counts = ['Ace', 'Bo', 'Cy'].map((n) => horses.filter((h) => h === n).length)
    expect(counts.sort()).toEqual([1, 2, 2])
  })

  it('keeps to the fit rule, and keeps the marks out of the show', () => {
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Cy', 'Dot', 'Eli', 'Fig'])
    // Only Fig carries group 3, and every horse but Eli is height restricted.
    for (const name of ['Ace', 'Bo', 'Cy', 'Dot', 'Eli']) fireEvent.change(screen.getByLabelText(`Heaviest weight group ${name} carries`), { target: { value: '1' } })
    for (const name of ['Ace', 'Bo', 'Cy', 'Dot', 'Fig']) {
      const row = screen.getByLabelText(`Heaviest weight group ${name} carries`).closest('li')!
      fireEvent.click(within(row).getByLabelText('Height restricted'))
    }
    // Level I, Sec. B has five riders. 125 is in group 3 and 662 is a height rider.
    fireEvent.click(screen.getByRole('button', { name: /Show the 59 riders \(0 marked\)/ }))
    fireEvent.change(screen.getByLabelText('Weight group of 125'), { target: { value: '3' } })
    fireEvent.click(within(screen.getByLabelText('Weight group of 662').closest('li')!).getByLabelText('Height rider'))
    expect(screen.getByRole('button', { name: 'Hide the riders' })).toBeTruthy()

    const panel = classPanel(/Level I Horsemanship, Sec\. B/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    for (let i = 0; i < 12; i++) {
      fireEvent.click(within(panel).getByRole('button', { name: /Draw (for this class|this class again)/ }))
      const entries = getClass('meet-6', '7')!.entries
      expect(entries.find((e) => e.back_no === '125')!.horse).toBe('Fig')
      expect(entries.find((e) => e.back_no === '662')!.horse).toBe('Eli')
      expect(new Set(entries.map((e) => e.horse)).size).toBe(5)
    }

    // By hand, the admin can still put a rider on a horse they do not fit. It is flagged, not blocked.
    fireEvent.change(within(panel).getByLabelText('Horse for 125'), { target: { value: 'Ace' } })
    expect(getClass('meet-6', '7')!.entries.find((e) => e.back_no === '125')!.horse).toBe('Ace')
    expect(within(within(panel).getByLabelText('Horse for 125').closest('li')!).getByText('Does not fit')).toBeTruthy()

    // The marks live in this computer's draw book and nowhere in the show.
    expect(drawBook(SUNDAY).riders).toEqual({ '125': { height: false, group: 3 }, '662': { height: true, group: 1 } })
    const saved = JSON.stringify(userShows())
    for (const word of ['height', 'group', 'takesHeight', 'maxGroup', 'riders"']) expect(saved).not.toContain(word)
  })

  it('draws again for one rider, and says when there is no other horse', () => {
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(['Ace', 'Bo', 'Cy', 'Dot', 'Eli'])
    // Rookie A has four riders. With five horses there is always exactly one other horse for a redraw.
    const panel = classPanel(/Rookie A Horsemanship/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    const before = getClass('meet-6', '12')!
    const spare = before.alternates![0]
    const first = before.entries[0]
    fireEvent.click(within(panel).getByRole('button', { name: `Draw again for ${first.back_no}` }))
    const after = getClass('meet-6', '12')!
    expect(after.entries[0].horse).toBe(spare)
    // The horse they gave up is the alternate now, and nobody else moved.
    expect(after.alternates).toEqual([first.horse])
    expect(after.entries.slice(1).map((e) => e.horse)).toEqual(before.entries.slice(1).map((e) => e.horse))
    expect(within(panel).getByRole('status').textContent).toBe(`${first.back_no} drew ${spare}.`)

    // Take the spare out of the set: now there is nothing else to draw.
    fireEvent.click(within(panel).getByRole('button', { name: new RegExp(`^${first.horse} `) }))
    fireEvent.click(within(panel).getByRole('button', { name: `Draw again for ${first.back_no}` }))
    expect(within(panel).getByRole('status').textContent).toBe(`There is no other horse in this set for ${first.back_no}.`)
  })

  it('offers the horses another show already used, and suggests the least used', () => {
    loadDraw()
    render(<DrawScreen showId={SUNDAY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add the horses from IHSA Western Show, November 21' }))
    // Saturday's draw used 23 horses.
    expect(drawBook(SUNDAY).horses).toHaveLength(23)
    const panel = classPanel(/Beginner Horsemanship/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick the least used' }))
    // Eight riders on the rail: eight horses and two alternates.
    expect(drawBook(SUNDAY).sets[classKey('meet-6', '11')]).toHaveLength(10)
  })
})

describe('alternates on the judge’s class list', () => {
  it('lists the alternate horses under the riders', () => {
    render(<DrawScreen showId={SUNDAY} />)
    addHorses(NINE)
    const panel = classPanel(/Rookie B Horsemanship, Sec\. A/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick all' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Draw for this class' }))
    const alternates = getClass('meet-6', '2')!.alternates!
    cleanup()
    render(<ClassScreen meetId="meet-6" classId="2" />)
    expect(screen.getByText('Alternate horses:').parentElement!.textContent).toBe(`Alternate horses: ${alternates.join(', ')}`)
  })
})
