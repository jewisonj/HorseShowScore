import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classKey, getClass } from '../data/fixture'
import { totalFor } from '../results'
import { loadDraw } from '../seed'
import { classState, clearAll, getState } from '../store'
import { RailScreen } from './RailScreen'

const LEVEL_I = '4' // Level I Horsemanship, Sec. A: six riders
const key = classKey('meet-5', LEVEL_I)
const runs = () => classState(getState(), key).runs
const rows = () => within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('button')
const give = (value: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: 'Rail work' })).getByRole('button', { name: value }))

beforeEach(() => {
  clearAll()
  loadDraw()
  window.location.hash = ''
})

afterEach(() => cleanup())

describe('rail work for a whole class', () => {
  it('lists the class in draw order and starts on the first rider', () => {
    render(<RailScreen meetId="meet-5" classId={LEVEL_I} />)
    expect(rows()).toHaveLength(6)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('6 riders left.')).toBeTruthy()
  })

  it('gives a score with one tap and moves to the next rider', () => {
    render(<RailScreen meetId="meet-5" classId={LEVEL_I} />)
    give('+2')
    give('+1')
    give('+3')
    expect(runs().map((r) => r.extras.rail ?? null)).toEqual([4, 2, 6, null, null, null])
    expect(rows()[3].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('3 riders left.')).toBeTruthy()
    // It is saved but the rider is not marked scored: the pattern is still to come.
    expect(runs()[0].scored).toBe(false)
  })

  it('adds the rail score to the rider’s total', () => {
    render(<RailScreen meetId="meet-5" classId={LEVEL_I} />)
    give('+2')
    expect(totalFor(runs()[0], getClass('meet-5', LEVEL_I)!).arithmetic).toBe(144) // 72
  })

  it('lets a score be changed or cleared, then goes on to whoever is left', () => {
    render(<RailScreen meetId="meet-5" classId={LEVEL_I} />)
    give('+2')
    give('+1')
    fireEvent.click(rows()[0])
    give('−1')
    expect(runs()[0].extras.rail).toBe(-2)
    expect(rows()[2].getAttribute('aria-pressed')).toBe('true') // the next rider without a score
    fireEvent.click(rows()[1])
    fireEvent.click(screen.getByRole('button', { name: 'Clear this one' }))
    expect(runs()[1].extras.rail).toBeNull()
    expect(screen.getByText('5 riders left.')).toBeTruthy()
  })

  it('stays put and says so when everyone has a score', () => {
    render(<RailScreen meetId="meet-5" classId={LEVEL_I} />)
    for (let i = 0; i < 6; i++) give('+1')
    expect(screen.getByText('Every rider has a rail score.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(window.location.hash).toBe('#/m/meet-5/c/4')
  })

  it('tells a class without rail work that it has none', () => {
    render(<RailScreen meetId="meet-5" classId="1" />) // reining
    expect(screen.getByText('This class has no rail work score.')).toBeTruthy()
  })
})
