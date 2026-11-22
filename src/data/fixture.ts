import raw from './ihsa-black-hawk-2026-11.json'
import { cloudShows } from './cloudShows'
import { userShows } from './shows'

export interface PatternBox {
  n: number
  /** Short code shown above the box on a phone, e.g. "Rr S" or "S&B" */
  abbr: string
  /** A few words, in the style of the maneuver description row on a score sheet */
  label: string
  tags: string[]
}

export interface Pattern {
  id: string
  name: string
  kind: string
  source_page: number
  boxes: PatternBox[]
  /** Where the picture of this pattern's page of the pattern book is kept on the server, e.g. "pages/pg-1a2b3c.jpg". */
  page_image?: string
}

export type CardFamily = 'pattern' | 'placings'

/** One line of the draw: who goes when, on which horse. */
export interface Entry {
  draw: number
  back_no: string
  rider: string
  horse: string
}

export interface ShowClass {
  /** Unique within the meet. The show's own running class number where known. */
  id: string
  /** The IHSA class number, 11 to 17. Sections of one class share it. */
  class_no: string
  name: string
  section: string
  card_family: CardFamily
  rule_set: string
  pattern_id: string
  notes: string
  entries: Entry[]
  /** Horses set aside for this class in case one is needed, in the order they would be used. */
  alternates?: string[]
}

export interface Meet {
  id: string
  label: string
  date: string
  coach_meeting: string
  start_time: string
  judges: string[]
  classes: ShowClass[]
}

export interface ShowEvent {
  id: string
  name: string
  association: string
  host: string
  start_date: string
  end_date: string
  is_test: boolean
}

/**
 * One show, complete in itself: its days, classes, draw and patterns.
 * This is what setup produces and what a phone opens. Meet ids and pattern ids
 * are unique across shows, so a class is found from its meet id alone.
 */
export interface ShowFile {
  format: 'hss-show'
  version: 1
  id: string
  name: string
  host: string
  association: string
  meets: Meet[]
  patterns: Pattern[]
}

export const event = raw.event as ShowEvent
export const meets = raw.meets as Meet[]
export const patterns = raw.patterns as Pattern[]

/**
 * The sample shows that ship with the app. Each day is a show of its own, the
 * way IHSA runs them and the way a show workbook holds them: one sheet, one show.
 * A sample show carries only the patterns its own classes ride.
 */
export const builtInShows: ShowFile[] = (raw.shows as { id: string; name: string; meet_ids: string[] }[]).map((s) => {
  const days = meets.filter((m) => s.meet_ids.includes(m.id))
  const used = new Set(days.flatMap((m) => m.classes.map((c) => c.pattern_id)))
  return {
    format: 'hss-show',
    version: 1,
    id: s.id,
    name: s.name,
    host: event.host,
    association: event.association,
    meets: days,
    patterns: patterns.filter((p) => used.has(p.id)),
  }
})

/** True for a show that ships with the app, whether or not a changed or published copy now stands in for it. */
export function isBuiltIn(showId: string): boolean {
  return builtInShows.some((s) => s.id === showId)
}

/** True while a show is still only the sample that ships with the app: nobody has changed or published it. */
export function isSample(showId: string): boolean {
  return isBuiltIn(showId) && !userShows().some((s) => s.id === showId) && !cloudShows().some((s) => s.id === showId)
}

const patternsById = new Map(patterns.map((p) => [p.id, p]))

/**
 * The sample shows first, then the shows added on this device, then the published
 * shows read from the server. One show per id: a copy being worked on here stands
 * in front of the published one, and either stands in front of a sample. That is
 * how a show admin turns a sample into the real show: change it, publish it.
 */
export function allShows(): ShowFile[] {
  const mine = userShows()
  const mineIds = new Set(mine.map((s) => s.id))
  const published = cloudShows().filter((s) => !mineIds.has(s.id))
  const replaced = new Set([...mine, ...published].map((s) => s.id))
  return [...builtInShows.filter((s) => !replaced.has(s.id)), ...mine, ...published]
}

export function getShow(showId: string): ShowFile | undefined {
  return allShows().find((s) => s.id === showId)
}

export function showOfMeet(meetId: string): ShowFile | undefined {
  return allShows().find((s) => s.meets.some((m) => m.id === meetId))
}

export function getMeet(meetId: string): Meet | undefined {
  for (const show of allShows()) {
    const meet = show.meets.find((m) => m.id === meetId)
    if (meet) return meet
  }
  return undefined
}

export function getClass(meetId: string, classId: string): ShowClass | undefined {
  return getMeet(meetId)?.classes.find((c) => c.id === classId)
}

export function findPattern(patternId: string): Pattern | undefined {
  // Same order as allShows: this device's copy, then the published one, then the sample.
  for (const show of [...userShows(), ...cloudShows()]) {
    const p = show.patterns.find((x) => x.id === patternId)
    if (p) return p
  }
  return patternsById.get(patternId)
}

export function getPattern(patternId: string): Pattern {
  const p = findPattern(patternId)
  if (!p) throw new Error(`Unknown pattern: ${patternId}`)
  return p
}

/** "3. LF right, SS right, stop" for the line that names the box being scored. */
export function boxLabel(box: PatternBox): string {
  return box.label.trim() === '' ? `Maneuver ${box.n}` : `${box.n}. ${box.label}`
}

export function classKey(meetId: string, classId: string): string {
  return `${meetId}:${classId}`
}

/** "Saturday, November 21" from an ISO date, without time zone drift. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}
