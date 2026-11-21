import type { CardFamily } from '../data/fixture'

/** The IHSA Western divisions, and what each one means for the card. */
export interface Division {
  class_no: string
  label: string
  rule_set: string
  card_family: CardFamily
  /** Which kind of pattern the class rides */
  kind: 'reining' | 'ranch_riding' | 'horsemanship'
}

export const DIVISIONS: Division[] = [
  { class_no: '17', label: 'Open Reining', rule_set: 'ihsa-reining', card_family: 'pattern', kind: 'reining' },
  { class_no: '16', label: 'Open Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
  { class_no: '15', label: 'Level II Ranch Riding', rule_set: 'ihsa-ranch-riding', card_family: 'pattern', kind: 'ranch_riding' },
  { class_no: '14', label: 'Level II Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
  { class_no: '13', label: 'Level I Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
  { class_no: '12B', label: 'Rookie B Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
  { class_no: '12A', label: 'Rookie A Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
  { class_no: '11', label: 'Beginner Horsemanship', rule_set: 'ihsa-horsemanship', card_family: 'placings', kind: 'horsemanship' },
]

export function divisionFor(classNo: string): Division {
  return DIVISIONS.find((d) => d.class_no === classNo) ?? DIVISIONS[1]
}

/** Work out the division from a class name such as "Level II Horsemanship, Sec. A". */
export function inferDivision(name: string): Division {
  const n = name.toLowerCase()
  const pick = (classNo: string) => divisionFor(classNo)
  if (n.includes('reining')) return pick('17')
  if (n.includes('ranch riding')) return pick('15')
  if (/level\s*(ii|2)\b/.test(n)) return pick('14')
  if (/level\s*(i|1)\b/.test(n)) return pick('13')
  if (/rookie\s*b\b/.test(n)) return pick('12B')
  if (/rookie\s*a\b/.test(n)) return pick('12A')
  if (n.includes('beginner')) return pick('11')
  return pick('16')
}

/** "A" from "Rookie B Horsemanship, Sec. A". Empty when the class has no sections. */
export function sectionOf(name: string): string {
  const m = /\bsec(?:tion|\.)?\s*([a-z0-9])\b/i.exec(name)
  return m ? m[1].toUpperCase() : ''
}

/** "ARCHIE (ROAN)" becomes "Archie (Roan)". */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s(\-'])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
    .trim()
}

const TAG_RULES: [string, RegExp][] = [
  ['spin', /\bspins?\b|\b[LR]S\b/],
  ['circle', /\bcircles?\b|\bLF\b|\bSS\b|\bfig(ure)?\b/i],
  ['lead_change', /\bchanges?\b|\bCL\b/i],
  ['rollback', /\brollbacks?\b|\b[LR]?RB[LR]?\b/i],
  ['stop', /\bstops?\b|\bhalts?\b|\bS&B\b|\bSB\b/i],
  ['backup', /\bback\b|\bS&B\b|\bSB\b/i],
  ['run', /\brun\b|\brundown\b|\brun-?around\b/i],
  ['walk', /\bwalk\b/i],
  ['trot', /\btrot\b/i],
  ['jog', /\bjog\b/i],
  ['lope', /\blope\b|\bleads?\b/i],
  ['obstacle', /\blogs?\b|\bside ?pass\b|\bgate\b|\bpoles?\b/i],
  ['turn', /\bturns?\b|\bpivots?\b|\b\d{2,3}\b/i],
]

/**
 * Tags for a maneuver, read from its words. They only decide which penalties
 * are listed first for that box, so a miss costs nothing but a longer look.
 */
export function tagsFor(words: string): string[] {
  return TAG_RULES.filter(([, re]) => re.test(words)).map(([tag]) => tag)
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "2026-11-21" from text such as "November 21, 2026 IHSA Western Show". Empty when there is no date. */
export function dateIn(text: string): string {
  const m = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text)
  if (!m) return ''
  const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)))
  if (month < 0) return ''
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** The day after an ISO date. */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}
