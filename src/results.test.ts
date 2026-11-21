import { beforeEach, describe, expect, it } from 'vitest'
import { classKey, getClass, getPattern, meets, patterns } from './data/fixture'
import { CSV_HEADER, classResults, placingWarnings, resultsCsv } from './results'
import { ruleSetFor } from './rules/rulesets'
import {
  addRiders,
  classState,
  clearAll,
  getState,
  parseBackNumbers,
  removeRun,
  saveRun,
  setPlacings,
  type Run,
} from './store'

beforeEach(() => {
  clearAll()
})

function scoreRun(key: string, backNo: string, boxes: number[], penalties: number[] = [], mark: Run['mark'] = 'none') {
  const run = classState(getState(), key).runs.find((r) => r.backNo === backNo)!
  saveRun(key, {
    ...run,
    boxes: run.boxes.map((_, i) => boxes[i] ?? 0),
    penalties: penalties.map((half) => ({ half, box: 0 })),
    mark,
    scored: true,
  })
}

describe('test data from the pattern book', () => {
  it('has two meets of eight classes and twelve patterns', () => {
    expect(meets).toHaveLength(2)
    expect(meets.map((m) => m.classes.length)).toEqual([8, 8])
    expect(patterns).toHaveLength(12)
  })

  it('has the box counts printed in the pattern book', () => {
    const counts = Object.fromEntries(patterns.map((p) => [p.id, p.boxes.length]))
    expect(counts).toEqual({
      'nrha-17': 8,
      'aqha-rr-10': 12,
      'hms-m': 10,
      'hms-t': 7,
      'hms-k': 8,
      'hms-q': 6,
      'nrha-8': 7,
      'aqha-rr-15': 12,
      'hms-r': 8,
      'hms-i': 7,
      'hms-s': 7,
      'hms-b': 7,
    })
  })

  it('every class points at a pattern and a rule set that exist', () => {
    for (const meet of meets) {
      for (const c of meet.classes) {
        expect(() => getPattern(c.pattern_id)).not.toThrow()
        expect(() => ruleSetFor(c.rule_set)).not.toThrow()
      }
    }
  })
})

describe('adding riders', () => {
  it('splits back numbers on spaces and commas', () => {
    expect(parseBackNumbers(' 214  187,302 ; 12a ')).toEqual(['214', '187', '302', '12A'])
  })

  it('skips a back number already in the class', () => {
    const key = classKey('meet-5', '17')
    expect(addRiders(key, ['214', '187'], 8)).toBe(2)
    expect(addRiders(key, ['187', '302'], 8)).toBe(1)
    expect(classState(getState(), key).runs.map((r) => r.backNo)).toEqual(['214', '187', '302'])
  })

  it('survives a reload: the state is written to localStorage on every change', () => {
    const key = classKey('meet-5', '17')
    addRiders(key, ['214'], 8)
    const stored = JSON.parse(localStorage.getItem('hss.state.v1')!)
    expect(stored.classes[key].runs[0].backNo).toBe('214')
  })
})

describe('a scored pattern class (reining)', () => {
  const key = classKey('meet-5', '17')
  const cls = getClass('meet-5', '17')!

  it('ranks by score, gives IHSA points, and leaves a zero unplaced', () => {
    addRiders(key, ['214', '187', '302', '455'], 8)
    scoreRun(key, '214', [1, 0, 2, -1, 0, 1, 1, 0], [1, 2]) // the 70½ card
    scoreRun(key, '187', [2, 2, 2, 2, 0, 0, 0, 0]) // 74
    scoreRun(key, '302', [0, 0, 0, 0, 0, 0, 0, 0]) // 70
    scoreRun(key, '455', [2, 2, 2, 2, 2, 2, 2, 2], [], 'ZERO')

    const rows = classResults(classState(getState(), key), cls)
    expect(rows.map((r) => [r.run.backNo, r.place, r.score, r.points])).toEqual([
      ['187', 1, 148, 7],
      ['214', 2, 141, 5],
      ['302', 3, 140, 4],
      ['455', null, 0, 0],
    ])
  })

  it('leaves riders who were never scored out of the results', () => {
    addRiders(key, ['214', '187'], 8)
    scoreRun(key, '214', [0, 0, 0, 0, 0, 0, 0, 0])
    const rows = classResults(classState(getState(), key), cls)
    expect(rows.map((r) => r.run.backNo)).toEqual(['214'])
  })
})

describe('ranch riding', () => {
  it('puts an OP ride below a clean one whatever it scored', () => {
    const key = classKey('meet-5', '15')
    const cls = getClass('meet-5', '15')!
    addRiders(key, ['10', '20'], 12)
    scoreRun(key, '10', [3, 3, 3, 3], [], 'OP') // 76 but off pattern
    scoreRun(key, '20', [0], [2, 6]) // 70 - 1 - 3 = 66
    const rows = classResults(classState(getState(), key), cls)
    expect(rows.map((r) => [r.run.backNo, r.place])).toEqual([
      ['20', 1],
      ['10', 2],
    ])
  })
})

describe('a placings class (horsemanship)', () => {
  const key = classKey('meet-5', '13')
  const cls = getClass('meet-5', '13')!

  it('uses the judge’s order and gives 7, 5, 4, 3, 2, 1', () => {
    addRiders(key, ['1', '2', '3', '4', '5', '6', '7'], 7)
    const ids = classState(getState(), key).runs.map((r) => r.id)
    setPlacings(key, [ids[3], ids[0], ids[6], ids[1], ids[2], ids[5], ids[4]])
    const rows = classResults(classState(getState(), key), cls)
    expect(rows.map((r) => [r.run.backNo, r.place, r.points])).toEqual([
      ['4', 1, 7],
      ['1', 2, 5],
      ['7', 3, 4],
      ['2', 4, 3],
      ['3', 5, 2],
      ['6', 6, 1],
      ['5', 7, 0],
    ])
  })

  it('warns when an OP rider is placed above a clean one in classes 11 to 13', () => {
    addRiders(key, ['1', '2'], 7)
    const [a, b] = classState(getState(), key).runs
    saveRun(key, { ...a, mark: 'OP' })
    setPlacings(key, [a.id, b.id])
    expect(placingWarnings(classState(getState(), key), cls)).toHaveLength(1)
    setPlacings(key, [b.id, a.id])
    expect(placingWarnings(classState(getState(), key), cls)).toHaveLength(0)
  })

  it('warns when an OP rider is placed at all in classes 14 and 16', () => {
    const openKey = classKey('meet-5', '16')
    const open = getClass('meet-5', '16')!
    addRiders(openKey, ['1', '2'], 10)
    const [a, b] = classState(getState(), openKey).runs
    saveRun(openKey, { ...a, mark: 'OP' })
    setPlacings(openKey, [b.id, a.id])
    expect(placingWarnings(classState(getState(), openKey), open)).toHaveLength(1)
  })

  it('drops a removed rider from the placings', () => {
    addRiders(key, ['1', '2'], 7)
    const [a, b] = classState(getState(), key).runs
    setPlacings(key, [a.id, b.id])
    removeRun(key, a.id)
    expect(classState(getState(), key).placings).toEqual([b.id])
  })
})

describe('CSV export', () => {
  it('has one row per rider, marked unverified, with scores as decimals', () => {
    const key = classKey('meet-5', '17')
    addRiders(key, ['214', '187'], 8)
    scoreRun(key, '214', [1, 0, 2, -1, 0, 1, 1, 0], [1, 2])
    const lines = resultsCsv(getState()).trim().split('\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Meet #5,2026-11-21,,17,Open Reining,NRHA Reining Pattern 17,214,1,70.5,1.5,,7,unverified')
    // Not scored: no placing, no score, no points. Partial data is normal.
    expect(lines[2]).toBe('Meet #5,2026-11-21,,17,Open Reining,NRHA Reining Pattern 17,187,,,,,,unverified')
  })

  it('is just the header when nothing has been entered', () => {
    expect(resultsCsv(getState())).toBe(CSV_HEADER.join(',') + '\n')
  })
})
