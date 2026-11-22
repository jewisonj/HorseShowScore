import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rowsFor } from '../cloud/scores'
import { builtInShows, classKey, getClass } from '../data/fixture'
import { clearShows, saveShow } from '../data/shows'
import { rerideHorses } from '../reride'
import { loadDraw } from '../seed'
import { classState, clearAll, getState, isReride, saveRun, setClassFinished, setPlacings, startReride } from '../store'
import { ClassScreen } from './ClassScreen'

// Saturday's class 2: Rookie B Horsemanship, Sec. A. Seven riders, each with a drawn horse.
const MEET = 'meet-5'
const CLASS = '2'
const KEY = classKey(MEET, CLASS)

beforeEach(() => {
  clearAll()
  clearShows()
  window.location.hash = ''
  loadDraw()
})

afterEach(() => cleanup())

const runs = () => classState(getState(), KEY).runs

function scoreFirst() {
  const first = runs()[0]
  saveRun(KEY, { ...first, boxes: first.boxes.map(() => 1), extras: { rail: 2, fe: 4 }, penalties: [{ half: 2, box: 1 }], note: 'Nice ride', scored: true })
  return runs()[0]
}

/** Give the class two alternates, the way the draw page saves them. */
function withAlternates(alternates: string[]) {
  const saturday = builtInShows.find((s) => s.id === 'evt-bhc-2026-11-21')!
  saveShow({ ...saturday, meets: saturday.meets.map((m) => ({ ...m, classes: m.classes.map((c) => (c.id === CLASS ? { ...c, alternates } : c)) })) })
}

describe('a re-ride on the judge’s device', () => {
  it('clears the card, keeps the first ride, changes the horse and sends the rider last', () => {
    const first = scoreFirst()
    setPlacings(KEY, [first.id, runs()[1].id])
    setClassFinished(KEY, true)

    expect(startReride(KEY, first.id, 'Hank')).toBe(true)

    const after = runs()
    expect(after).toHaveLength(7)
    const again = after[6]
    expect(again.id).toBe(first.id)
    expect(again.backNo).toBe(first.backNo)
    expect(again.horse).toBe('Hank')
    // A clear card of the same size.
    expect(again.boxes).toEqual(first.boxes.map(() => null))
    expect(again.extras).toEqual({})
    expect(again.penalties).toEqual([])
    expect(again.note).toBeUndefined()
    expect(again.scored).toBe(false)
    // The first ride is kept exactly as it was scored.
    expect(again.previous).toHaveLength(1)
    expect(again.previous![0]).toMatchObject({ horse: first.horse, boxes: first.boxes, extras: { rail: 2, fe: 4 }, penalties: [{ half: 2, box: 1 }], note: 'Nice ride', scored: true })
    // They are out of the placings and the class is open again.
    const cs = classState(getState(), KEY)
    expect(cs.placings).toEqual([after[0].id])
    expect(cs.finished).toBe(false)
    expect(startReride(KEY, 'no-such-run', 'Hank')).toBe(false)
  })

  it('keeps the re-ride horse and place in line when the draw is read again', () => {
    const first = scoreFirst()
    startReride(KEY, first.id, 'Hank')
    expect(loadDraw()).toBe(0)
    const after = runs()
    expect(after[6].id).toBe(first.id)
    expect(after[6].horse).toBe('Hank')
    // Everyone else still has the horse they drew.
    const drawn = getClass(MEET, CLASS)!.entries
    for (const run of after.slice(0, 6)) expect(run.horse).toBe(drawn.find((e) => e.back_no === run.backNo)!.horse)
  })

  it('tells the office it is a re-ride, with the new horse and only the new card', () => {
    const first = scoreFirst()
    startReride(KEY, first.id, 'Hank')
    const again = runs()[6]
    saveRun(KEY, { ...again, boxes: again.boxes.map(() => 0), scored: true })
    const cls = getClass(MEET, CLASS)!
    // A horsemanship class sends the riders the judge has placed. Until they are placed again, there is no row.
    expect(rowsFor(classState(getState(), KEY), cls).find((r) => r.back_no === first.backNo)).toBeUndefined()
    setPlacings(KEY, [first.id])
    const row = rowsFor(classState(getState(), KEY), cls).find((r) => r.back_no === first.backNo)!
    expect(row.reride).toBe(1)
    expect(row.horse).toBe('Hank')
    expect(row.card!.boxes).toEqual(again.boxes.map(() => 0))
    expect(row.card!.penalties).toEqual([])
    expect(row.note).toBeUndefined()
    // A second re-ride counts up, and takes them out of the placings again.
    startReride(KEY, first.id, 'Rock')
    expect(classState(getState(), KEY).placings).toEqual([])
    saveRun(KEY, { ...runs()[6], boxes: runs()[6].boxes.map(() => 1), scored: true })
    setPlacings(KEY, [first.id])
    const second = rowsFor(classState(getState(), KEY), cls).find((r) => r.back_no === first.backNo)!
    expect([second.reride, second.horse]).toEqual([2, 'Rock'])
    expect(runs()[6].previous).toHaveLength(2)
  })

  it('offers the class’s next alternate first, then any other horse', () => {
    withAlternates(['Hank', 'Jazz'])
    const cls = getClass(MEET, CLASS)!
    const show = builtInShows.find((s) => s.id === 'evt-bhc-2026-11-21')!
    let horses = rerideHorses({ ...show, meets: show.meets.map((m) => ({ ...m, classes: m.classes.map((c) => (c.id === CLASS ? cls : c)) })) }, cls, classState(getState(), KEY))
    expect(horses.alternates).toEqual(['Hank', 'Jazz'])
    expect(horses.others).toContain('George')
    expect(horses.others).not.toContain('Hank')
    // Once a re-ride has taken Hank, Jazz is next. Hank can still be picked from the other horses.
    startReride(KEY, runs()[0].id, 'Hank')
    horses = rerideHorses({ ...show, meets: show.meets.map((m) => ({ ...m, classes: m.classes.map((c) => (c.id === CLASS ? cls : c)) })) }, cls, classState(getState(), KEY))
    expect(horses.alternates).toEqual(['Jazz'])
    expect(horses.others).toContain('Hank')
  })
})

describe('calling a re-ride from the class list', () => {
  it('takes the rider and the horse, and says what happened', () => {
    withAlternates(['Hank', 'Jazz'])
    const first = scoreFirst()
    render(<ClassScreen meetId={MEET} classId={CLASS} />)
    expect(screen.getByText('Alternate horses:').parentElement!.textContent).toBe('Alternate horses: Hank, Jazz')
    fireEvent.click(screen.getByRole('button', { name: 'Call a re-ride' }))
    // The first alternate is already picked. Nothing happens until a rider is picked too.
    const horse = screen.getByLabelText('Horse for the re-ride') as HTMLSelectElement
    expect(horse.value).toBe('Hank')
    const start = screen.getByRole('button', { name: 'Start the re-ride' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Rider for the re-ride'), { target: { value: first.id } })
    fireEvent.click(start)

    expect(screen.getAllByRole('status').map((el) => el.textContent).join(' ')).toContain(`Re-ride set for ${first.backNo} on Hank. They ride last, on a clear card.`)
    const rows = screen.getAllByRole('button', { name: /^Back number/ })
    expect(rows).toHaveLength(7)
    expect(rows[6].getAttribute('aria-label')).toBe(`Back number ${first.backNo}, ${first.rider}, on Hank, re-ride. Not scored`)
    expect(within(rows[6]).getByText('Re-ride')).toBeTruthy()
    expect(isReride(runs()[6])).toBe(true)

    // A second re-ride in the class is offered the next alternate.
    fireEvent.click(screen.getByRole('button', { name: 'Call a re-ride' }))
    expect((screen.getByLabelText('Horse for the re-ride') as HTMLSelectElement).value).toBe('Jazz')
  })

  it('makes the judge pick a horse when the class has no alternate left, and can keep the same horse', () => {
    const first = runs()[0]
    render(<ClassScreen meetId={MEET} classId={CLASS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Call a re-ride' }))
    const horse = screen.getByLabelText('Horse for the re-ride') as HTMLSelectElement
    expect(horse.value).toBe('')
    fireEvent.change(screen.getByLabelText('Rider for the re-ride'), { target: { value: first.id } })
    expect((screen.getByRole('button', { name: 'Start the re-ride' }) as HTMLButtonElement).disabled).toBe(true)
    // Every horse in the show is offered, and the horse the rider is on.
    expect(Array.from(horse.options).map((o) => o.text)).toContain('George')
    const same = Array.from(horse.options).find((o) => o.text === 'The same horse')!
    fireEvent.change(horse, { target: { value: same.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Start the re-ride' }))
    expect(runs()[6].horse).toBe(first.horse)
    expect(runs()[6].previous).toHaveLength(1)
  })
})
