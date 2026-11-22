import { beforeEach, describe, expect, it } from 'vitest'
import { classKey, getClass, getPattern, meets, patterns } from './data/fixture'
import raw from './data/ihsa-black-hawk-2026-11.json'
import { CSV_HEADER, classResults, placingWarnings, resultsCsv, totalFor } from './results'
import { reasonsFor, ruleSetFor } from './rules/rulesets'
import { loadDraw } from './seed'
import {
  STORAGE_KEY,
  addRiders,
  classState,
  clearAll,
  getState,
  parseBackNumbers,
  removeRun,
  saveRun,
  setPlacings,
  type Penalty,
  type Run,
} from './store'

// Saturday's classes by the show's running number.
const REINING = '1'
const RANCH = '3'
const LEVEL_I = '4' // IHSA class 13
const OPEN = '6' // IHSA class 16

beforeEach(() => {
  clearAll()
})

function scoreRun(
  key: string,
  backNo: string,
  boxes: number[],
  penalties: (number | Penalty)[] = [],
  mark: Run['mark'] = 'none',
  extras: Run['extras'] = {},
) {
  const run = classState(getState(), key).runs.find((r) => r.backNo === backNo)!
  saveRun(key, {
    ...run,
    boxes: run.boxes.map((_, i) => boxes[i] ?? 0),
    extras,
    penalties: penalties.map((p) => (typeof p === 'number' ? { half: p, box: 0 } : p)),
    mark,
    scored: true,
  })
}

describe('test data', () => {
  it('has twelve classes a day in running order, and twelve patterns', () => {
    expect(meets).toHaveLength(2)
    expect(meets.map((m) => m.classes.length)).toEqual([12, 12])
    // Sunday runs the same classes as Saturday, by the same numbers and names.
    expect(meets[1].classes.map((c) => [c.id, c.name])).toEqual(meets[0].classes.map((c) => [c.id, c.name]))
    expect(meets[0].classes.map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(meets[0].classes.slice(0, 3).map((c) => [c.name, c.class_no, c.section])).toEqual([
      ['Reining', '17', ''],
      ['Rookie B Horsemanship, Sec. A', '12B', 'A'],
      ['Ranch Riding', '15', ''],
    ])
    expect(patterns).toHaveLength(12)
  })

  it('names every box with a short code and a few words', () => {
    for (const p of patterns) {
      for (const b of p.boxes) {
        expect(b.abbr.length, `${p.id} box ${b.n}`).toBeGreaterThan(0)
        expect(b.abbr.length, `${p.id} box ${b.n}`).toBeLessThanOrEqual(9)
        expect(b.label.length, `${p.id} box ${b.n}`).toBeGreaterThan(0)
      }
    }
    expect(getPattern('nrha-8').boxes.map((b) => b.abbr)).toEqual(['4 LS', '4 RS', 'RrR CL', 'LlL CL', 'LRB', 'RRB', 'SB'])
  })

  it('a draw line is draw, back number, rider and horse, and nothing else about people', () => {
    // This repo is public. The owner cleared rider names. Schools, coaches and judges stay out.
    for (const m of meets) {
      expect(m.judges).toEqual([])
      for (const c of m.classes) {
        for (const e of c.entries) {
          expect(Object.keys(e).sort()).toEqual(['back_no', 'draw', 'horse', 'rider'])
          expect(e.rider.trim()).toBe(e.rider)
          expect(e.rider.length).toBeGreaterThan(0)
        }
      }
    }
    // Class and meet records carry only these fields.
    const classFields = ['card_family', 'class_no', 'entries', 'id', 'name', 'notes', 'pattern_id', 'rule_set', 'section']
    for (const m of raw.meets) for (const c of m.classes) expect(Object.keys(c).sort()).toEqual(classFields)
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
    const key = classKey('meet-5', REINING)
    expect(addRiders(key, ['214', '187'], 8)).toBe(2)
    expect(addRiders(key, ['187', '302'], 8)).toBe(1)
    expect(classState(getState(), key).runs.map((r) => r.backNo)).toEqual(['214', '187', '302'])
  })

  it('survives a reload: the state is written to localStorage on every change', () => {
    const key = classKey('meet-5', REINING)
    addRiders(key, ['214'], 8)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.classes[key].runs[0].backNo).toBe('214')
  })
})

describe('the draw', () => {
  it('fills Saturday’s classes in draw order with each rider’s horse', () => {
    // Saturday's 75 rides and Sunday's 74.
    expect(loadDraw()).toBe(75 + 74)
    const reining = classState(getState(), classKey('meet-5', REINING)).runs
    expect(reining.map((r) => [r.draw, r.backNo, r.horse])).toEqual([
      [1, '1025', 'George'],
      [2, '102', 'Bunny'],
      [3, '1007', 'Cisco'],
      [4, '553', 'Rey'],
      [5, '576', 'George'],
    ])
    // Every rider comes with the name from the draw.
    const fixture = getClass('meet-5', REINING)!.entries
    expect(reining.map((r) => r.rider)).toEqual(fixture.map((e) => e.rider))
    expect(reining[0].boxes).toHaveLength(8)
    expect(classState(getState(), classKey('meet-5', RANCH)).runs).toHaveLength(10)
    // Sunday's riders come from the show program, in program order. Their horses are drawn in setup.
    const sunday = classState(getState(), classKey('meet-6', REINING)).runs
    expect(sunday.map((r) => [r.draw, r.backNo])).toEqual([[1, '102'], [2, '1007'], [3, '553'], [4, '576'], [5, '1025']])
    expect(sunday.every((r) => !r.horse)).toBe(true)
  })

  it('leaves a class alone once this device has touched it', () => {
    loadDraw()
    const key = classKey('meet-5', REINING)
    const first = classState(getState(), key).runs[0]
    saveRun(key, { ...first, boxes: first.boxes.map(() => 1), scored: true })
    removeRun(key, classState(getState(), key).runs[4].id)
    expect(loadDraw()).toBe(0)
    const after = classState(getState(), key).runs
    expect(after).toHaveLength(4)
    expect(after[0].scored).toBe(true)
  })

  it('fills in name, horse and draw order for riders already on the device, without touching scores', () => {
    // A device that loaded an earlier draw, or had back numbers typed in by hand.
    const key = classKey('meet-5', REINING)
    addRiders(key, ['576', '1025', '999'], 8)
    scoreRun(key, '1025', [1, 1, 1, 1, 1, 1, 1, 1], [{ half: 2, box: 3 }], 'none', { fe: 6 })
    // The other eleven classes, the three riders of this class's draw the device did not have yet, and Sunday's 74.
    expect(loadDraw()).toBe(73 + 74)
    const entries = getClass('meet-5', REINING)!.entries
    const runs = classState(getState(), key).runs
    expect(runs.slice(0, 3).map((r) => [r.backNo, r.draw, r.horse, r.rider])).toEqual([
      ['576', 5, 'George', entries[4].rider],
      ['1025', 1, 'George', entries[0].rider],
      // Typed in by hand and not in the draw: left as it is.
      ['999', undefined, undefined, undefined],
    ])
    expect(runs.slice(3).map((r) => r.draw)).toEqual([2, 3, 4])
    expect(runs.slice(3).every((r) => !r.scored && r.boxes.every((b) => b === null))).toBe(true)
    expect(runs[1].boxes).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(runs[1].penalties).toEqual([{ half: 2, box: 3 }])
    expect(runs[1].extras).toEqual({ fe: 6 })
    expect(runs[1].scored).toBe(true)
  })
})

describe('a scored pattern class (reining)', () => {
  const key = classKey('meet-5', REINING)
  const cls = getClass('meet-5', REINING)!

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

  it('adds F&E to the score, as the IHSA sheet does', () => {
    addRiders(key, ['214'], 8)
    scoreRun(key, '214', [0, 0, 0, 0, 1, 1, 1, 0], [], 'none', { fe: 4 }) // +1½ and F&E 2
    const [run] = classState(getState(), key).runs
    expect(totalFor(run, cls).score).toBe(147) // 73½
  })

  it('does not count a circled penalty', () => {
    addRiders(key, ['214'], 8)
    scoreRun(key, '214', [0], [{ half: 4, box: 2 }, { half: 10, box: 4, circled: true }])
    const [run] = classState(getState(), key).runs
    const t = totalFor(run, cls)
    expect(t.penaltySum).toBe(4)
    expect(t.score).toBe(136) // 70 − 2, the circled 5 is left out
  })
})

describe('penalty lists', () => {
  it('every penalty value on a card has a list or records the number alone', () => {
    for (const id of ['ihsa-reining', 'ihsa-ranch-riding', 'ihsa-horsemanship']) {
      const rs = ruleSetFor(id)
      expect(rs.verified).toBe(false)
      for (const p of rs.penalties) {
        const ids = p.reasons.map((r) => r.id)
        expect(new Set(ids).size, `${id} ${p.half}`).toBe(ids.length)
      }
    }
    expect(ruleSetFor('ihsa-reining').penalties.map((p) => p.half)).toEqual([1, 2, 4, 10])
    expect(ruleSetFor('ihsa-ranch-riding').penalties.map((p) => p.half)).toEqual([2, 6, 10, 20])
  })

  it('puts the penalties that fit the maneuver first', () => {
    const ranch = ruleSetFor('ihsa-ranch-riding')
    expect(reasonsFor(ranch, 2, ['walk'])[0].id).toBe('break-walk-trot-2')
    expect(reasonsFor(ranch, 2, ['lope'])[0].id).toBe('lead-2')
    expect(reasonsFor(ranch, 6, ['stop', 'obstacle'])[0].id).toBe('obstacle')
    expect(reasonsFor(ranch, 2, ['walk'])).toHaveLength(5)
  })
})

describe('ranch riding', () => {
  it('puts an OP ride below a clean one whatever it scored', () => {
    const key = classKey('meet-5', RANCH)
    const cls = getClass('meet-5', RANCH)!
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
  const key = classKey('meet-5', LEVEL_I)
  const cls = getClass('meet-5', LEVEL_I)!

  it('totals the horsemanship sheet: maneuvers, rail work and F&E, less penalties', () => {
    addRiders(key, ['1'], 7)
    scoreRun(key, '1', [-1, -2, -1, 0, -2, -2, 0], [{ half: 6, box: 1 }], 'none', { rail: 2, fe: 2 })
    const [run] = classState(getState(), key).runs
    expect(totalFor(run, cls).score).toBe(130) // 70 − 4 + 1 + 1 − 3 = 65
  })

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
    const openKey = classKey('meet-5', OPEN)
    const open = getClass('meet-5', OPEN)!
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
    loadDraw()
    const key = classKey('meet-5', REINING)
    scoreRun(
      key,
      '1025',
      [1, 0, 2, -1, 0, 1, 1, 0],
      [
        { half: 1, box: 0, reason: 'jog-2' },
        { half: 2, box: 2 },
        { half: 10, box: 5, reason: 'saddle', circled: true },
      ],
      'none',
      { fe: 4 },
    )
    const lines = resultsCsv(getState()).trim().split('\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines).toHaveLength(1 + 75 + 74)
    const cells = (line: string) => Object.fromEntries(CSV_HEADER.map((name, i) => [name, line.split(',')[i]]))
    expect(cells(lines[1])).toEqual({
      meet: 'Saturday',
      date: '2026-11-21',
      judge: '',
      show_class: '1',
      class_no: '17',
      class: 'Reining',
      pattern: 'NRHA Reining Pattern 17',
      draw: '1',
      back_number: '1025',
      rider: getClass('meet-5', REINING)!.entries[0].rider,
      horse: 'George',
      placing: '1',
      score: '72.5', // 70 + 2 + F&E 2 − 1½, the circled 5 is not counted
      rail_work: '',
      fe: '2',
      penalty_total: '1.5',
      penalties: '1:0.5 jog 2 strides; 3:1; 6:5 holding saddle (circled)',
      mark: '',
      points: '7',
      status: 'unverified',
      note: '',
    })
    // Not scored: no placing, no score, no points. Partial data is normal.
    const second = getClass('meet-5', REINING)!.entries[1].rider
    expect(lines[2]).toBe(`Saturday,2026-11-21,,1,17,Reining,NRHA Reining Pattern 17,2,102,${second},Bunny,,,,,,,,,unverified,`)
  })

  it('is just the header when nothing has been entered', () => {
    expect(resultsCsv(getState())).toBe(CSV_HEADER.join(',') + '\n')
  })
})
