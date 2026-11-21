import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classKey } from '../data/fixture'
import { resultsCsv } from '../results'
import { STORAGE_KEY, addRiders, classState, clearAll, getState } from '../store'
import { ScoreCard } from './ScoreCard'

// Saturday's classes by the show's running number.
const REINING = '1' // NRHA 17, 8 boxes, F&E
const RANCH = '3' // AQHA ranch riding 10, 12 boxes, F&E
const LEVEL_I = '4' // horsemanship pattern T, 7 boxes, rail work and F&E

function openCard(classId = REINING, boxes = 8) {
  const key = classKey('meet-5', classId)
  addRiders(key, ['214'], boxes)
  const run = classState(getState(), key).runs[0]
  render(<ScoreCard meetId="meet-5" classId={classId} runId={run.id} />)
  return key
}

const tap = (name: string | RegExp, group?: string) => {
  const scope = group ? within(screen.getByRole('group', { name: group })) : screen
  fireEvent.click(scope.getByRole('button', { name }))
}

const savedRun = (key = classKey('meet-5', REINING)) => classState(getState(), key).runs[0]
const total = () => document.querySelector('.total-value')?.textContent
const sheet = () => screen.queryByRole('dialog')

beforeEach(() => {
  clearAll()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the score card', () => {
  it('starts at 70 with the first maneuver selected', () => {
    openCard()
    expect(total()).toBe('70')
    expect(screen.getByRole('button', { name: /^Maneuver 1,/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('names each maneuver above its box, as a short code and in words', () => {
    openCard()
    const first = screen.getByRole('button', { name: /^Maneuver 1,/ })
    expect(first.querySelector('.box-abbr')?.textContent).toBe('Ll S')
    expect(first.querySelector('.box-text')?.textContent).toBe('LF left, SS left, stop')
    expect(screen.getByRole('button', { name: /^Maneuver 8,/ }).querySelector('.box-abbr')?.textContent).toBe('SB')
    // The strip above the keys spells out the box being scored.
    expect(document.querySelector('.current-label')?.textContent).toBe('1. LF left, SS left, stop')
  })

  it('records each tap, moves to the next box, and totals 70½ for the worked example', () => {
    openCard()
    // boxes +½, 0, +1, −½, 0, +½, +½, 0 with penalties ½ and 1
    tap('½', 'Penalty') // called during maneuver 1
    tap(/^Jogging up to 2 strides/)
    tap('+½', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('1', 'Penalty') // called during maneuver 3
    tap(/^Out of lead/)
    tap('+1', 'Maneuver score')
    tap('−½', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('+½', 'Maneuver score')
    tap('+½', 'Maneuver score')
    tap('0', 'Maneuver score')

    expect(total()).toBe('70½')
    const run = savedRun()
    expect(run.boxes).toEqual([1, 0, 2, -1, 0, 1, 1, 0])
    expect(run.penalties).toEqual([
      { half: 1, box: 0, reason: 'jog-2' },
      { half: 2, box: 2, reason: 'out-of-lead' },
    ])
  })

  it('saves every tap to storage straight away, before Save run is pressed', () => {
    const key = openCard()
    tap('+1', 'Maneuver score')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.classes[key].runs[0].boxes[0]).toBe(2)
    expect(stored.classes[key].runs[0].scored).toBe(false)
  })

  it('undo takes back the last tap and returns to that box', () => {
    openCard()
    tap('+1', 'Maneuver score')
    tap('2', 'Penalty')
    tap('Just the number')
    tap('Undo')
    expect(savedRun().penalties).toEqual([])
    tap('Undo')
    expect(savedRun().boxes[0]).toBeNull()
    expect(screen.getByRole('button', { name: /^Maneuver 1,/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('lets the operator go back to a box and change it', () => {
    openCard()
    tap('+1', 'Maneuver score')
    tap('0', 'Maneuver score')
    fireEvent.click(screen.getByRole('button', { name: /^Maneuver 1,/ }))
    tap('−1', 'Maneuver score')
    expect(savedRun().boxes.slice(0, 2)).toEqual([-2, 0])
  })

  it('Score 0 overrides the arithmetic and can be switched back off', () => {
    openCard()
    tap('+1', 'Maneuver score')
    tap('Score 0')
    expect(total()).toBe('0')
    tap('Score 0')
    expect(total()).toBe('71')
  })

  it('Save run marks the rider scored and returns to the class', () => {
    openCard()
    for (let i = 0; i < 8; i++) tap('0', 'Maneuver score')
    tap('2', 'Form and effectiveness')
    tap('Save run')
    expect(savedRun().scored).toBe(true)
    expect(window.location.hash).toBe('#/m/meet-5/c/1')
  })

  it('asks before saving a run with something left blank, and says what', () => {
    openCard()
    for (let i = 0; i < 7; i++) tap('0', 'Maneuver score')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    tap('Save run')
    expect(confirm).toHaveBeenCalledWith('1 maneuver and F&E have no score. Save the run anyway?')
    expect(savedRun().scored).toBe(false)
  })
})

describe('a note for the rider', () => {
  it('is typed on the card, saved as it is typed, and left out of Undo', () => {
    const key = classKey('meet-5', LEVEL_I)
    addRiders(key, ['777'], 7)
    const rider = () => classState(getState(), key).runs.find((r) => r.backNo === '777')!
    render(<ScoreCard meetId="meet-5" classId={LEVEL_I} runId={rider().id} />)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Nice ride. Watch your legs.' } })
    expect(rider().note).toBe('Nice ride. Watch your legs.')
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect(resultsCsv(getState()).split('\n').find((l) => l.includes('Watch your legs'))).toBeTruthy()
  })
})

describe('F&E and rail work', () => {
  it('moves to F&E after the last maneuver and adds it to the score', () => {
    openCard()
    for (let i = 0; i < 8; i++) tap('0', 'Maneuver score')
    expect(screen.getByRole('button', { name: /^Form and effectiveness/ }).getAttribute('aria-pressed')).toBe('true')
    tap('3', 'Form and effectiveness')
    expect(total()).toBe('73')
    expect(savedRun().extras).toEqual({ fe: 6 })
  })

  it('takes no penalty while F&E is selected', () => {
    openCard()
    fireEvent.click(screen.getByRole('button', { name: /^Form and effectiveness/ }))
    const half = within(screen.getByRole('group', { name: 'Penalty' })).getByRole('button', { name: '½' })
    expect((half as HTMLButtonElement).disabled).toBe(true)
  })

  it('horsemanship card runs to ±3 and totals the real card: 70 − ½ + rail 2 + F&E 1 − 1 = 71½', () => {
    const key = openCard(LEVEL_I, 7)
    // maneuvers 0, −1, −1, 0, 0, +1, +½, with a penalty of 1 in maneuver 3
    tap('0', 'Maneuver score')
    tap('−1', 'Maneuver score')
    tap('1', 'Penalty') // no list for horsemanship yet, so it is recorded without asking
    expect(sheet()).toBeNull()
    tap('−1', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('+1', 'Maneuver score')
    tap('+½', 'Maneuver score')
    // F&E is selected next. Rail work is given on its own time.
    tap('1', 'Form and effectiveness')
    fireEvent.click(screen.getByRole('button', { name: /^Rail work/ }))
    tap('+2', 'Rail work')
    expect(total()).toBe('71½')
    expect(savedRun(key).extras).toEqual({ fe: 2, rail: 4 })
    // the scale goes to three either way
    fireEvent.click(screen.getByRole('button', { name: /^Maneuver 1,/ }))
    tap('+3', 'Maneuver score')
    expect(savedRun(key).boxes[0]).toBe(6)
  })
})

describe('which penalty', () => {
  it('lists the penalties for that value, with the ones that fit the maneuver first', () => {
    openCard()
    fireEvent.click(screen.getByRole('button', { name: /^Maneuver 2,/ })) // four spins left
    tap('½', 'Penalty')
    const dialog = screen.getByRole('dialog', { name: 'Which ½ point penalty?' })
    const reasons = Array.from(dialog.querySelectorAll('.reason')).map((b) => b.textContent)
    expect(reasons[0]).toBe('Over or under spin, up to ⅛ turn')
    expect(reasons[reasons.length - 1]).toBe('Just the number')
    expect(within(dialog).getByText('2. 4 spins left')).toBeTruthy()
  })

  it('Cancel records nothing', () => {
    openCard()
    tap('5', 'Penalty')
    tap('Cancel')
    expect(sheet()).toBeNull()
    expect(savedRun().penalties).toEqual([])
    expect(total()).toBe('70')
  })

  it('a value with one listed penalty is recorded without asking', () => {
    const key = openCard(RANCH, 12)
    tap('5', 'Penalty')
    expect(sheet()).toBeNull()
    expect(savedRun(key).penalties).toEqual([{ half: 10, box: 0, reason: 'disobedience' }])
    expect(total()).toBe('65')
  })

  it('a circled penalty stays on the card and is not counted', () => {
    openCard()
    tap('5', 'Penalty')
    tap(/^Circled/)
    tap('Holding the saddle')
    expect(savedRun().penalties).toEqual([{ half: 10, box: 0, reason: 'saddle', circled: true }])
    expect(total()).toBe('70')
    expect(screen.getByRole('button', { name: /^Maneuver 1,/ }).querySelector('.pen-circled')?.textContent).toBe('5')
  })

  it('a penalty can be changed, uncircled or removed from the box it was called in', () => {
    openCard()
    tap('5', 'Penalty')
    tap('Just the number')
    expect(total()).toBe('65')

    tap(/^Penalty 5\. Change or remove/)
    tap('Spurring in front of the cinch')
    expect(savedRun().penalties).toEqual([{ half: 10, box: 0, reason: 'spurring' }])

    tap(/^Penalty 5, spurring\. Change or remove/)
    tap(/^Circled/)
    expect(total()).toBe('70')
    tap(/^Circled/)
    expect(total()).toBe('65')
    tap('Remove this penalty')
    expect(savedRun().penalties).toEqual([])
    expect(total()).toBe('70')
  })
})
