import raw from './ihsa-black-hawk-2026-11.json'

export interface PatternBox {
  n: number
  label: string
  tags: string[]
}

export interface Pattern {
  id: string
  name: string
  kind: string
  source_page: number
  start_note: string
  finish_note: string
  boxes: PatternBox[]
}

export type CardFamily = 'pattern' | 'placings'

export interface ShowClass {
  class_no: string
  name: string
  card_family: CardFamily
  rule_set: string
  pattern_id: string
  notes: string
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

export function getClass(meetId: string, classNo: string): ShowClass | undefined {
  return getMeet(meetId)?.classes.find((c) => c.class_no === classNo)
}

export function getPattern(patternId: string): Pattern {
  const p = patternsById.get(patternId)
  if (!p) throw new Error(`Unknown pattern: ${patternId}`)
  return p
}

/** A box label for the screen. Patterns without wording show "Maneuver 3". */
export function boxLabel(box: PatternBox): string {
  return box.label.trim() === '' ? `Maneuver ${box.n}` : `${box.n}. ${box.label}`
}

/** True when the pattern carries its own maneuver wording. */
export function hasLabels(pattern: Pattern): boolean {
  return pattern.boxes.some((b) => b.label.trim() !== '')
}

export function classKey(meetId: string, classNo: string): string {
  return `${meetId}:${classNo}`
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
