import raw from './ihsa-black-hawk-2026-11.json'

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

export const event = raw.event as ShowEvent
export const meets = raw.meets as Meet[]
export const patterns = raw.patterns as Pattern[]

const patternsById = new Map(patterns.map((p) => [p.id, p]))

export function getMeet(meetId: string): Meet | undefined {
  return meets.find((m) => m.id === meetId)
}

export function getClass(meetId: string, classId: string): ShowClass | undefined {
  return getMeet(meetId)?.classes.find((c) => c.id === classId)
}

export function getPattern(patternId: string): Pattern {
  const p = patternsById.get(patternId)
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
