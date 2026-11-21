import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classKey } from '../data/fixture'
import { addRiders, classState, clearAll, getState } from '../store'
import { ScoreCard } from './ScoreCard'

const key = classKey('meet-5', '17') // Open Reining, NRHA 17, 8 boxes

function openCard() {
  addRiders(key, ['214'], 8)
  const run = classState(getState(), key).runs[0]
  render(<ScoreCard meetId="meet-5" classNo="17" runId={run.id} />)
  return run.id
}

const tap = (name: string | RegExp, group?: string) => {
  const scope = group ? within(screen.getByRole('group', { name: group })) : screen
  fireEvent.click(scope.getByRole('button', { name }))
}

const savedRun = () => classState(getState(), key).runs[0]

beforeEach(() => {
  clearAll()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
})

describe('the score card', () => {
  it('starts at 70 with the first maneuver selected', () => {
    openCard()
    expect(document.querySelector('.total-value')?.textContent).toBe('70')
    expect(screen.getByRole('button', { name: /^Maneuver 1,/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('records each tap, moves to the next box, and totals 70½ for the worked example', () => {
    openCard()
    // boxes +½, 0, +1, −½, 0, +½, +½, 0 with penalties ½ and 1
    tap('½', 'Penalty') // called during maneuver 1
    tap('+½', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('1', 'Penalty') // called during maneuver 3
    tap('+1', 'Maneuver score')
    tap('−½', 'Maneuver score')
    tap('0', 'Maneuver score')
    tap('+½', 'Maneuver score')
    tap('+½', 'Maneuver score')
    tap('0', 'Maneuver score')

    expect(document.querySelector('.total-value')?.textContent).toBe('70½')
    const run = savedRun()
    expect(run.boxes).toEqual([1, 0, 2, -1, 0, 1, 1, 0])
    expect(run.penalties).toEqual([
      { half: 1, box: 0 },
      { half: 2, box: 2 },
    ])
  })

  it('saves every tap to storage straight away, before Save run is pressed', () => {
    openCard()
    tap('+1', 'Maneuver score')
    const stored = JSON.parse(localStorage.getItem('hss.state.v1')!)
    expect(stored.classes[key].runs[0].boxes[0]).toBe(2)
    expect(stored.classes[key].runs[0].scored).toBe(false)
  })

  it('undo takes back the last tap and returns to that box', () => {
    openCard()
    tap('+1', 'Maneuver score')
    tap('2', 'Penalty')
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

  it('a penalty can be removed from the box it was called in', () => {
    openCard()
    tap('5', 'Penalty')
    expect(document.querySelector('.total-value')?.textContent).toBe('65')
    fireEvent.click(screen.getByRole('button', { name: /5.*remove/ }))
    expect(document.querySelector('.total-value')?.textContent).toBe('70')
  })

  it('Score 0 overrides the arithmetic and can be switched back off', () => {
    openCard()
    tap('+1', 'Maneuver score')
    tap('Score 0')
    expect(document.querySelector('.total-value')?.textContent).toBe('0')
    tap('Score 0')
    expect(document.querySelector('.total-value')?.textContent).toBe('71')
  })

  it('Save run marks the rider scored and returns to the class', () => {
    openCard()
    for (let i = 0; i < 8; i++) tap('0', 'Maneuver score')
    tap('Save run')
    expect(savedRun().scored).toBe(true)
    expect(window.location.hash).toBe('#/m/meet-5/c/17')
  })
})
