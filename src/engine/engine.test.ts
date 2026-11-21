import { describe, expect, it } from 'vitest'
import {
  aggregate,
  cardTotal,
  closestTwo,
  dropHighLow,
  formatHalf,
  IHSA_POINTS,
  pointsForPlace,
  rankScored,
  shareAndSkip,
  teamTotal,
  toHalf,
} from './index'

// These are the test vectors from the requirements (doc 02, section 6).
// If a rulebook check changes one, change the doc and this file together.

const h = toHalf

describe('half points', () => {
  it('stores 70½ as 141', () => {
    expect(h(70.5)).toBe(141)
  })
  it('rejects anything that is not a multiple of one half', () => {
    expect(() => h(70.25)).toThrow()
  })
  it('formats like a scribe writes', () => {
    expect(formatHalf(141)).toBe('70½')
    expect(formatHalf(140)).toBe('70')
    expect(formatHalf(1)).toBe('½')
    expect(formatHalf(0)).toBe('0')
    expect(formatHalf(-3)).toBe('−1½')
    expect(formatHalf(-1)).toBe('−½')
    expect(formatHalf(3, { sign: true })).toBe('+1½')
    expect(formatHalf(1, { sign: true })).toBe('+½')
    expect(formatHalf(0, { sign: true })).toBe('0')
  })
})

describe('card totals', () => {
  it('reining card: 70 + 2 - 1½ = 70½', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(0.5), h(0), h(1), h(-0.5), h(0), h(0.5), h(0.5), h(0)],
      penalties: [h(0.5), h(1)],
    })
    expect(t.boxSum).toBe(h(2))
    expect(t.penaltySum).toBe(h(1.5))
    expect(t.score).toBe(h(70.5))
    expect(t.complete).toBe(true)
  })

  it('ranch riding card: boxes +2½, penalties 1 and 3 = 68½', () => {
    const t = cardTotal({ base: h(70), boxes: [h(1), h(1), h(0.5)], penalties: [h(1), h(3)] })
    expect(t.score).toBe(h(68.5))
  })

  it('NRCHA cow work card at NRCHA mark values = 70', () => {
    // ✓+ = +½, + = +1, ✓ = 0, ✓+ = +½, + = +1, ✓ = 0
    const t = cardTotal({
      base: h(70),
      boxes: [h(0.5), h(1), h(0), h(0.5), h(1), h(0)],
      penalties: [h(1), h(1), h(1)],
    })
    expect(t.score).toBe(h(70))
  })

  it('an unscored box makes the card incomplete but still totals', () => {
    const t = cardTotal({ base: h(70), boxes: [h(0.5), null], penalties: [] })
    expect(t.complete).toBe(false)
    expect(t.score).toBe(h(70.5))
  })

  it('ZERO scores 0, DQ has no score, OP keeps its score', () => {
    const base = { base: h(70), boxes: [h(1)], penalties: [] }
    expect(cardTotal({ ...base, mark: 'ZERO' }).score).toBe(0)
    expect(cardTotal({ ...base, mark: 'DQ' }).score).toBeNull()
    expect(cardTotal({ ...base, mark: 'OP' }).score).toBe(h(71))
  })
})

// The arithmetic of IHSA score sheets filled in at a real meet on 7 November 2026.
// Each one is how the judge's own total works out: 70 + maneuvers + rail work + F&E - penalties.
describe('IHSA sheets: rail work and F&E are added to the score', () => {
  it('reining: maneuvers +1½, F&E 2 = 73½', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(0), h(0), h(0), h(0), h(0.5), h(0.5), h(0.5)],
      extras: [h(2)],
      penalties: [],
    })
    expect(t.extraSum).toBe(h(2))
    expect(t.score).toBe(h(73.5))
  })

  it('reining: maneuvers −1, F&E 1 = 70', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(0), h(-0.5), h(0), h(0), h(-0.5), h(0.5), h(-0.5)],
      extras: [h(1)],
      penalties: [],
    })
    expect(t.score).toBe(h(70))
  })

  it('ranch riding: maneuvers +1½, F&E 1 = 72½', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(0), h(0), h(0), h(1), h(0.5), h(0), h(0.5), h(0.5), h(0.5), h(-0.5), h(0), h(-1)],
      extras: [h(1)],
      penalties: [],
    })
    expect(t.score).toBe(h(72.5))
  })

  it('horsemanship: maneuvers −½, rail 2, F&E 1, penalty 1 = 71½', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(0), h(-1), h(-1), h(0), h(0), h(1), h(0.5)],
      extras: [h(2), h(1)],
      penalties: [h(1)],
    })
    expect(t.boxSum).toBe(h(-0.5))
    expect(t.score).toBe(h(71.5))
  })

  it('horsemanship: maneuvers −4, rail 1, F&E 1, penalty 3 = 65', () => {
    const t = cardTotal({
      base: h(70),
      boxes: [h(-0.5), h(-1), h(-0.5), h(0), h(-1), h(-1), h(0)],
      extras: [h(1), h(1)],
      penalties: [h(3)],
    })
    expect(t.score).toBe(h(65))
  })

  it('horsemanship: every maneuver +½, rail 3, F&E 3 = 79', () => {
    const t = cardTotal({ base: h(70), boxes: Array(6).fill(h(0.5)), extras: [h(3), h(3)], penalties: [] })
    expect(t.score).toBe(h(79))
  })

  it('an extra with no score yet leaves the card incomplete', () => {
    const t = cardTotal({ base: h(70), boxes: [h(0)], extras: [null], penalties: [] })
    expect(t.complete).toBe(false)
    expect(t.score).toBe(h(70))
  })
})

describe('several judges', () => {
  it('five judges, drop high and low: 218', () => {
    expect(dropHighLow([h(72), h(73.5), h(71), h(74), h(72.5)])).toBe(h(218))
  })
  it('three judges, closest two: 72, 73, 75 = 145', () => {
    expect(closestTwo([h(72), h(73), h(75)])).toBe(h(145))
  })
  it('three judges evenly spaced drops the lowest: 71, 72, 73 = 145', () => {
    expect(closestTwo([h(71), h(72), h(73)])).toBe(h(145))
  })
  it('three judges, high pair closer: 70, 73, 74 = 147', () => {
    expect(closestTwo([h(70), h(73), h(74)])).toBe(h(147))
  })
  it('composite of two judges over two events: 290½', () => {
    const rein = aggregate('sum', [h(71), h(72.5)])
    const cow = aggregate('sum', [h(73), h(74)])
    expect(rein + cow).toBe(h(290.5))
  })
  it('NRCHA zero in one event still gives a composite', () => {
    expect(0 + h(146)).toBe(h(146))
  })
})

describe('placings', () => {
  it('shared placings skip the next place: 1, 2, 2, 4, 5', () => {
    expect(shareAndSkip([h(72), h(71), h(71), h(70), h(69)])).toEqual([1, 2, 2, 4, 5])
  })

  it('OP ranks below every clean ride whatever it scored', () => {
    const r = rankScored([
      { id: 'a', score: h(68), mark: 'none' },
      { id: 'b', score: h(74), mark: 'OP' },
      { id: 'c', score: h(71), mark: 'none' },
    ])
    expect(r.find((x) => x.id === 'c')?.place).toBe(1)
    expect(r.find((x) => x.id === 'a')?.place).toBe(2)
    expect(r.find((x) => x.id === 'b')?.place).toBe(3)
  })

  it('ZERO, DQ and unscored are not placed', () => {
    const r = rankScored([
      { id: 'a', score: 0, mark: 'ZERO' },
      { id: 'b', score: null, mark: 'DQ' },
      { id: 'c', score: null, mark: 'none' },
      { id: 'd', score: h(70), mark: 'none' },
    ])
    expect(r.map((x) => x.place)).toEqual([null, null, null, 1])
  })

  it('flags ties so a judge can break them', () => {
    const r = rankScored([
      { id: 'a', score: h(70), mark: 'none' },
      { id: 'b', score: h(70), mark: 'none' },
      { id: 'c', score: h(69), mark: 'none' },
    ])
    expect(r.map((x) => [x.place, x.tied])).toEqual([
      [1, true],
      [1, true],
      [3, false],
    ])
  })
})

describe('IHSA points and team totals', () => {
  it('points are 7, 5, 4, 3, 2, 1 and nothing after sixth', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((p) => pointsForPlace(p))).toEqual([7, 5, 4, 3, 2, 1, 0])
    expect(pointsForPlace(null)).toBe(0)
    expect(IHSA_POINTS).toHaveLength(6)
  })
  it('team total is the best six of seven point riders', () => {
    expect(teamTotal([7, 5, 4, 3, 2, 1, 0])).toBe(22)
    expect(teamTotal([7, 7, 5, 5, 4, 3, 1])).toBe(31)
    expect(teamTotal([7, 7, 7, 7, 7, 7, 7])).toBe(42)
  })
  it('a team with fewer than six point riders just adds what it has', () => {
    expect(teamTotal([7, 5])).toBe(12)
  })
})
