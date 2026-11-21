import type { Meet, Pattern, ShowFile } from '../data/fixture'
import { newId } from '../data/shows'
import { tagsFor } from './build'

/** One pattern as the reader found it, turned into the app's shape. */
export interface ReadPattern {
  pattern: Pattern
  /** The classes the book says ride it, as written there. */
  classes: string[]
  /** What the reader could not make out. Empty when it was clear. */
  unsure: string
}

const KINDS = ['reining', 'ranch_riding', 'horsemanship']
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * What came back from the pattern book reader, checked field by field.
 * Anything that is not a pattern with a name and at least one box is dropped.
 */
export function patternsFromReader(found: unknown): { patterns: ReadPattern[]; notes: string } {
  const f = found as { patterns?: unknown; notes?: unknown } | null
  const list = f && typeof f === 'object' && Array.isArray(f.patterns) ? (f.patterns as Record<string, unknown>[]) : []
  const patterns: ReadPattern[] = []
  for (const raw of list.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue
    const name = clean(raw.name, 80)
    const boxes = (Array.isArray(raw.boxes) ? (raw.boxes as Record<string, unknown>[]) : [])
      .slice(0, 30)
      .map((b) => ({ abbr: clean(b?.code, 12), label: clean(b?.words, 80) }))
      .filter((b) => b.abbr !== '' || b.label !== '')
      .map((b, i) => ({ n: i + 1, abbr: b.abbr, label: b.label, tags: tagsFor(b.label) }))
    if (name === '' || boxes.length === 0) continue
    const kind = clean(raw.kind, 20).toLowerCase()
    patterns.push({
      pattern: {
        id: newId('p'),
        name,
        kind: KINDS.includes(kind) ? kind : 'other',
        source_page: typeof raw.page === 'number' && Number.isFinite(raw.page) ? Math.max(0, Math.round(raw.page)) : 0,
        boxes,
      },
      classes: (Array.isArray(raw.classes) ? raw.classes : []).map((c) => clean(c, 60)).filter((c) => c !== ''),
      unsure: clean(raw.unsure, 300),
    })
  }
  return { patterns, notes: f && typeof f === 'object' ? clean(f.notes, 500) : '' }
}

/** IHSA class numbers named in a line such as "Level II/Open Horsemanship". Empty when it names none. */
export function divisionsNamed(text: string): string[] {
  const n = text.toLowerCase()
  if (n.includes('reining')) return ['17']
  if (/ranch\s*riding/.test(n)) return ['15']
  const out: string[] = []
  if (/level\s*(ii|2)\b/.test(n)) out.push('14')
  if (/level\s*(i|1)\b/.test(n)) out.push('13')
  if (n.includes('rookie')) {
    const a = /rookie\s*a\b/.test(n)
    const b = /rookie\s*b\b/.test(n)
    if (a || !b) out.push('12A')
    if (b || !a) out.push('12B')
  }
  if (n.includes('beginner')) out.push('11')
  if (/\bopen\b/.test(n)) out.push('16')
  return out
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The days of the show a line points at. Every day when it names none. */
function daysNamed(text: string, meets: Meet[]): Meet[] {
  const n = text.toLowerCase()
  const named = WEEKDAYS.filter((d) => n.includes(d) || new RegExp(`\\b${d.slice(0, 3)}\\b`).test(n))
  if (named.length === 0) return meets
  return meets.filter((m) => {
    const label = m.label.toLowerCase()
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? WEEKDAYS[new Date(`${m.date}T12:00:00`).getDay()] : ''
    return named.some((d) => label.includes(d) || fromDate === d)
  })
}

/**
 * Add the chosen patterns to a show and give each class its pattern where the
 * book leaves no doubt. A class that already has a pattern keeps it. A class
 * that two of the patterns claim is left for a person to decide.
 */
export function addReadPatterns(show: ShowFile, chosen: ReadPattern[]): { show: ShowFile; added: number; replaced: number; assigned: number } {
  const patterns = [...show.patterns]
  let added = 0
  let replaced = 0
  const idOf = new Map<ReadPattern, string>()
  for (const item of chosen) {
    const at = patterns.findIndex((p) => p.name.trim().toLowerCase() === item.pattern.name.toLowerCase())
    if (at >= 0) {
      // Same name as one already here: take the newly read boxes, keep the id so classes stay pointed at it.
      patterns[at] = { ...item.pattern, id: patterns[at].id }
      idOf.set(item, patterns[at].id)
      replaced++
    } else {
      patterns.push(item.pattern)
      idOf.set(item, item.pattern.id)
      added++
    }
  }

  // Which patterns claim which class.
  const claims = new Map<string, Set<string>>()
  for (const item of chosen) {
    for (const line of item.classes) {
      const divisions = divisionsNamed(line)
      const number = /^\s*(?:class\s*)?#?\s*(\d{1,3})\s*$/i.exec(line)?.[1]
      for (const meet of daysNamed(line, show.meets)) {
        for (const cls of meet.classes) {
          if (!(divisions.includes(cls.class_no) || (number !== undefined && cls.id === number))) continue
          const key = `${meet.id}:${cls.id}`
          if (!claims.has(key)) claims.set(key, new Set())
          claims.get(key)!.add(idOf.get(item)!)
        }
      }
    }
  }

  let assigned = 0
  const meets = show.meets.map((meet) => ({
    ...meet,
    classes: meet.classes.map((cls) => {
      const claim = claims.get(`${meet.id}:${cls.id}`)
      if (cls.pattern_id !== '' || !claim || claim.size !== 1) return cls
      assigned++
      return { ...cls, pattern_id: [...claim][0] }
    }),
  }))
  return { show: { ...show, patterns, meets }, added, replaced, assigned }
}
