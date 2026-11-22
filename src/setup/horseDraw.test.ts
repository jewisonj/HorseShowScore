import { describe, expect, it } from 'vitest'
import { drawClass, drawPlaces, fits, redrawOne, suggestSet, rideCounts, type DrawHorse, type DrawRider } from './horseDraw'

/** A repeatable random source, so a failing draw can be run again. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rider = (backNo: string, group: 1 | 2 | 3 = 1, height = false): DrawRider => ({ backNo, group, height })
const horse = (name: string, maxGroup: 1 | 2 | 3 = 3, takesHeight = true): DrawHorse => ({ name, maxGroup, takesHeight })

describe('the fit rule', () => {
  it('lets a rider draw a horse that carries their weight group and, for a height rider, takes height riders', () => {
    expect(fits(rider('1', 1), horse('A', 1))).toBe(true)
    expect(fits(rider('1', 2), horse('A', 1))).toBe(false)
    expect(fits(rider('1', 3), horse('A', 3))).toBe(true)
    expect(fits(rider('1', 1, true), horse('A', 3, false))).toBe(false)
    expect(fits(rider('1', 1, true), horse('A', 3, true))).toBe(true)
    // A rider who is not a height rider can draw any horse their weight group allows.
    expect(fits(rider('1', 1, false), horse('A', 3, false))).toBe(true)
  })
})

describe('drawing a class', () => {
  const seven = ['1', '2', '3', '4', '5', '6', '7'].map((n) => rider(n))
  const nine = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((n) => horse(n))

  it('gives every rider a horse, no horse twice, and lists the rest as alternates', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = drawClass(seven, nine, { reuse: false, random: seeded(seed) })
      expect(Object.keys(r.horseOf).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
      expect(new Set(Object.values(r.horseOf)).size).toBe(7)
      expect(r.alternates).toHaveLength(2)
      expect([...Object.values(r.horseOf), ...r.alternates].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
      expect(r.noHorse).toEqual([])
    }
  })

  it('is random: over many draws every horse turns up for a rider', () => {
    const seen = new Set<string>()
    const firsts = new Map<string, number>()
    for (let seed = 1; seed <= 400; seed++) {
      const r = drawClass(seven, nine, { reuse: false, random: seeded(seed) })
      seen.add(r.horseOf['1'])
      firsts.set(r.horseOf['1'], (firsts.get(r.horseOf['1']) ?? 0) + 1)
    }
    expect(seen.size).toBe(9)
    // Nine horses, 400 draws: about 44 each. None is far out of line.
    for (const n of firsts.values()) {
      expect(n).toBeGreaterThan(20)
      expect(n).toBeLessThan(75)
    }
  })

  it('never gives a rider a horse they do not fit', () => {
    const riders = [rider('10', 3), rider('11', 2), rider('12', 1, true), rider('13', 1), rider('14', 3, true)]
    const horses = [horse('Big', 3, true), horse('Tall', 3, true), horse('Mid', 2, false), horse('Light', 1, true), horse('Pony', 1, false), horse('Mid2', 2, true)]
    for (let seed = 1; seed <= 200; seed++) {
      const r = drawClass(riders, horses, { reuse: false, random: seeded(seed) })
      expect(r.noHorse).toEqual([])
      for (const who of riders) {
        const got = horses.find((h) => h.name === r.horseOf[who.backNo])!
        expect(fits(who, got), `seed ${seed}: ${who.backNo} on ${got.name}`).toBe(true)
      }
      expect(new Set(Object.values(r.horseOf)).size).toBe(5)
    }
  })

  it('finishes a draw that can only be finished one way', () => {
    // Only Big carries group 3, only Tall takes height riders. Drawn carelessly, someone lighter takes Big first.
    const riders = [rider('1', 3), rider('2', 1, true), rider('3', 1)]
    const horses = [horse('Big', 3, false), horse('Tall', 1, true), horse('Any', 1, false)]
    for (let seed = 1; seed <= 100; seed++) {
      const r = drawClass(riders, horses, { reuse: false, random: seeded(seed) })
      expect(r.horseOf).toEqual({ '1': 'Big', '2': 'Tall', '3': 'Any' })
    }
  })

  it('says who has no horse when the set cannot seat everyone', () => {
    const r = drawClass([rider('1', 3), rider('2', 3), rider('3', 1)], [horse('Big', 3), horse('Light', 1)], { reuse: false, random: seeded(3) })
    expect(Object.keys(r.horseOf)).toHaveLength(2)
    expect(r.noHorse).toHaveLength(1)
    expect(['1', '2']).toContain(r.noHorse[0])
    // More riders than horses in a rail class: the ones left are named, and nobody shares.
    const short = drawClass(seven, nine.slice(0, 5), { reuse: false, random: seeded(4) })
    expect(new Set(Object.values(short.horseOf)).size).toBe(5)
    expect(short.noHorse).toHaveLength(2)
  })

  it('lets a horse go again in a class ridden one at a time, and keeps the use even', () => {
    const ten = Array.from({ length: 10 }, (_, i) => rider(String(i + 1)))
    const sevenHorses = nine.slice(0, 7)
    for (let seed = 1; seed <= 50; seed++) {
      const r = drawClass(ten, sevenHorses, { reuse: true, random: seeded(seed) })
      expect(Object.keys(r.horseOf)).toHaveLength(10)
      expect(r.noHorse).toEqual([])
      const counts = [...rideCounts([{ entries: Object.values(r.horseOf).map((h) => ({ horse: h })) }]).values()]
      expect(counts).toHaveLength(7)
      expect(Math.max(...counts)).toBe(2)
      expect(r.alternates).toEqual([])
    }
  })
})

describe('drawing onto the draw places a sheet already has horses in', () => {
  it('gives every rider a place of their own, at random, and a horse listed twice goes twice', () => {
    // Reining, the way a sheet lists it: five places, George in two of them.
    const places = [horse('Bunny'), horse('George'), horse('Cisco'), horse('Rey'), horse('George')]
    const five = ['1', '2', '3', '4', '5'].map((n) => rider(n))
    const firstPlace = new Set<number>()
    for (let seed = 1; seed <= 200; seed++) {
      const r = drawPlaces(five, places, seeded(seed))
      expect(Object.values(r.placeOf).sort()).toEqual([0, 1, 2, 3, 4])
      expect(r.free).toEqual([])
      expect(r.noHorse).toEqual([])
      firstPlace.add(r.placeOf['1'])
    }
    // Over many draws a rider lands in every place.
    expect(firstPlace.size).toBe(5)
  })

  it('keeps to the fit rule and skips places with no horse', () => {
    const places = [horse('Light', 1), null, horse('Big', 3), horse('Mid', 2, false)]
    const riders = [rider('1', 3), rider('2', 1), rider('3', 2)]
    for (let seed = 1; seed <= 100; seed++) {
      const r = drawPlaces(riders, places, seeded(seed))
      // Only Big carries group 3, so the group 2 rider must be on Mid and the light rider on Light.
      expect(r.placeOf).toEqual({ '1': 2, '2': 0, '3': 3 })
    }
  })

  it('names the riders left over and the places left free', () => {
    const r = drawPlaces([rider('1', 3), rider('2', 3)], [horse('Big', 3), horse('Light', 1), horse('Light2', 1)], seeded(2))
    expect(Object.keys(r.placeOf)).toHaveLength(1)
    expect(r.noHorse).toHaveLength(1)
    expect(r.free).toEqual([1, 2])
    const short = drawPlaces(['1', '2', '3'].map((n) => rider(n)), [horse('A'), horse('B')], seeded(5))
    expect(Object.keys(short.placeOf)).toHaveLength(2)
    expect(short.noHorse).toHaveLength(1)
  })
})

describe('drawing again for one rider', () => {
  const horses = [horse('A'), horse('B'), horse('C', 1), horse('D')]
  const drawn = { '1': 'A', '2': 'B' }

  it('gives a different horse that fits and that nobody else has', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const got = redrawOne(rider('1', 2), horses, drawn, { reuse: false, random: seeded(seed) })
      // Not A (their own), not B (taken), not C (too light a horse for group 2).
      expect(got).toBe('D')
    }
  })

  it('says so when there is no other horse', () => {
    expect(redrawOne(rider('1', 2), horses.slice(0, 3), drawn, { reuse: false, random: seeded(1) })).toBeNull()
    // Where a horse may go again, a horse someone else has is better than none.
    expect(redrawOne(rider('1', 2), horses.slice(0, 3), drawn, { reuse: true, random: seeded(1) })).toBe('B')
  })
})

describe('suggesting the horses for a class', () => {
  it('offers the least-used horses first and leaves out horses nobody in the class fits', () => {
    const used = new Map([['A', 3], ['B', 1], ['C', 0], ['D', 2], ['Pony', 0]])
    const horses = [horse('A'), horse('B'), horse('C'), horse('D'), horse('Pony', 1)]
    const heavy = [rider('1', 2), rider('2', 3)]
    expect(suggestSet(heavy, horses, used, 3, seeded(1))).toEqual(['C', 'B', 'D'])
    expect(suggestSet(heavy, horses, used, 9, seeded(1))).toEqual(['C', 'B', 'D', 'A'])
  })

  it('counts rides per horse from the draw', () => {
    const counts = rideCounts([{ entries: [{ horse: 'A' }, { horse: 'B' }, { horse: '' }] }, { entries: [{ horse: 'A' }] }])
    expect([...counts]).toEqual([['A', 2], ['B', 1]])
  })
})
