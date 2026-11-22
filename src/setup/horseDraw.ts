/**
 * The horse draw: which rider gets which horse in one class.
 *
 * It is the paper draw done by the computer. The horses for a class are set,
 * then every rider draws one at random. A rider who draws a horse they do not
 * fit draws again. Nothing here knows a rider's height or weight: it works from
 * a yes or no and a group number.
 *
 * Pure: no storage, no network, no screen. The random source can be handed in,
 * so a test can repeat a draw.
 */

export type WeightGroup = 1 | 2 | 3

export interface DrawRider {
  backNo: string
  /** A height rider only draws horses that take height riders. */
  height: boolean
  /** 1 is the lightest group. A rider with no group set is in 1 and fits any horse. */
  group: WeightGroup
}

export interface DrawHorse {
  name: string
  takesHeight: boolean
  /** The heaviest weight group this horse carries. */
  maxGroup: WeightGroup
}

export interface DrawResult {
  /** Back number to horse name, for every rider who got a horse. */
  horseOf: Record<string, string>
  /** Horses set for the class that nobody drew, in the order they came out. */
  alternates: string[]
  /** Back numbers no horse in the set fits, or that were left without one. */
  noHorse: string[]
}

export interface DrawOptions {
  /**
   * True for a class ridden one rider at a time (reining, ranch riding): a horse
   * may go again once every horse has gone. False for a class that works the
   * rail together: no horse goes twice.
   */
  reuse: boolean
  /** A number from 0 up to, not including, 1. Defaults to Math.random. */
  random?: () => number
}

/** The fit rule, confirmed by the owner on 2026-11-21. */
export function fits(rider: Pick<DrawRider, 'height' | 'group'>, horse: Pick<DrawHorse, 'takesHeight' | 'maxGroup'>): boolean {
  return rider.group <= horse.maxGroup && (!rider.height || horse.takesHeight)
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** One pass of the hat: every rider, in a random order, draws at random from the horses left that fit. */
function deal(riders: DrawRider[], horses: DrawHorse[], random: () => number): Map<string, string> {
  const left = shuffled(horses, random)
  const got = new Map<string, string>()
  for (const rider of shuffled(riders, random)) {
    const can = left.filter((h) => fits(rider, h))
    if (can.length === 0) continue
    const pick = can[Math.floor(random() * can.length)]
    left.splice(left.indexOf(pick), 1)
    got.set(rider.backNo, pick.name)
  }
  return got
}

/**
 * The most riders that can each have a horse of their own, by augmenting paths
 * over a shuffled order. Used when the plain deal keeps running into a dead end,
 * so a draw that can be completed always is.
 */
function bestMatch(riders: DrawRider[], horses: DrawHorse[], random: () => number): Map<string, string> {
  const hs = shuffled(horses, random)
  const rs = shuffled(riders, random)
  const riderOfHorse = new Map<number, number>()
  const tryRider = (r: number, seen: Set<number>): boolean => {
    for (const h of shuffled(hs.map((_, i) => i), random)) {
      if (seen.has(h) || !fits(rs[r], hs[h])) continue
      seen.add(h)
      const other = riderOfHorse.get(h)
      if (other === undefined || tryRider(other, seen)) {
        riderOfHorse.set(h, r)
        return true
      }
    }
    return false
  }
  rs.forEach((_, r) => tryRider(r, new Set()))
  const got = new Map<string, string>()
  for (const [h, r] of riderOfHorse) got.set(rs[r].backNo, hs[h].name)
  return got
}

/** Draw one class. Every rider who can have a horse gets one. */
export function drawClass(riders: DrawRider[], horses: DrawHorse[], options: DrawOptions): DrawResult {
  const random = options.random ?? Math.random
  const horseOf: Record<string, string> = {}
  let waiting = [...riders]
  let firstRound = true
  let unused: string[] = []

  while (waiting.length > 0) {
    // Deal, and deal again if someone was left out who need not have been.
    const most = bestMatch(waiting, horses, random).size
    let got = new Map<string, string>()
    for (let attempt = 0; attempt < 40 && got.size < most; attempt++) got = deal(waiting, horses, random)
    if (got.size < most) got = bestMatch(waiting, horses, random)
    if (got.size === 0) break
    for (const [backNo, horse] of got) horseOf[backNo] = horse
    if (firstRound) {
      const used = new Set(got.values())
      unused = shuffled(horses.filter((h) => !used.has(h.name)), random).map((h) => h.name)
      firstRound = false
    }
    waiting = waiting.filter((r) => !got.has(r.backNo))
    if (!options.reuse) break
  }

  return { horseOf, alternates: unused, noHorse: waiting.map((r) => r.backNo) }
}

export interface PlacesResult {
  /** Back number to the draw place they drew, counted from 0. */
  placeOf: Record<string, number>
  /** Draw places that have a horse and no rider, lowest first. */
  free: number[]
  /** Back numbers left without a place: no free horse fits them, or there are more riders than horses. */
  noHorse: string[]
}

/**
 * Draw riders onto draw places that already have their horses, the way a show
 * sheet is filled in: the horse committee sets a horse beside each draw place,
 * then every rider draws a place at random. A horse can be listed in two places
 * when it goes twice. A place with no horse (null) is never drawn.
 */
export function drawPlaces(riders: DrawRider[], places: (DrawHorse | null)[], random: () => number = Math.random): PlacesResult {
  // Each place is its own thing to draw, even when two hold the same horse.
  const slots = places.map((h, i) => (h ? { ...h, name: String(i) } : null)).filter((h): h is DrawHorse => h !== null)
  const most = bestMatch(riders, slots, random).size
  let got = new Map<string, string>()
  for (let attempt = 0; attempt < 40 && got.size < most; attempt++) got = deal(riders, slots, random)
  if (got.size < most) got = bestMatch(riders, slots, random)
  const placeOf: Record<string, number> = {}
  for (const [backNo, slot] of got) placeOf[backNo] = Number(slot)
  const taken = new Set(Object.values(placeOf))
  return {
    placeOf,
    free: slots.map((h) => Number(h.name)).filter((i) => !taken.has(i)),
    noHorse: riders.filter((r) => !got.has(r.backNo)).map((r) => r.backNo),
  }
}

/**
 * Draw again for one rider. They get a different horse that fits, at random:
 * one nobody else in the class has when horses may not go twice. Returns the
 * horse, or null when there is no other horse for them.
 */
export function redrawOne(
  rider: DrawRider,
  horses: DrawHorse[],
  horseOf: Record<string, string>,
  options: DrawOptions,
): string | null {
  const random = options.random ?? Math.random
  const mine = horseOf[rider.backNo]
  const taken = new Set(Object.entries(horseOf).filter(([backNo]) => backNo !== rider.backNo).map(([, horse]) => horse))
  let can = horses.filter((h) => fits(rider, h) && h.name !== mine)
  const free = can.filter((h) => !taken.has(h.name))
  if (!options.reuse) can = free
  else if (free.length > 0) can = free
  if (can.length === 0) return null
  return can[Math.floor(random() * can.length)].name
}

/** How many rides each horse has across a set of classes. */
export function rideCounts(classes: { entries: { horse: string }[] }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of classes) {
    for (const e of c.entries) {
      const horse = e.horse.trim()
      if (horse) counts.set(horse, (counts.get(horse) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * A suggested set of horses for a class: the least-used ones first, so use
 * evens out over the day. Only horses that fit at least one rider are offered.
 * Ties are broken at random. The admin can change the set before drawing.
 */
export function suggestSet(
  riders: DrawRider[],
  horses: DrawHorse[],
  used: Map<string, number>,
  count: number,
  random: () => number = Math.random,
): string[] {
  const useful = shuffled(
    horses.filter((h) => riders.length === 0 || riders.some((r) => fits(r, h))),
    random,
  )
  useful.sort((a, b) => (used.get(a.name) ?? 0) - (used.get(b.name) ?? 0))
  return useful.slice(0, Math.max(0, count)).map((h) => h.name)
}
