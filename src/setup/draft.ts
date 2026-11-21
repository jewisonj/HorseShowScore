import { allShows, type Meet, type Pattern, type PatternBox, type ShowClass, type ShowFile } from '../data/fixture'
import { newId } from '../data/shows'
import { divisionFor, tagsFor, type Division } from './build'

/** A show being set up. It has the same shape as a finished show, with gaps still allowed. */

export function blankMeet(showId: string, n: number, label = 'Saturday'): Meet {
  return { id: `${showId}-m${n}`, label, date: '', coach_meeting: '', start_time: '', judges: [], classes: [] }
}

export function blankShow(): ShowFile {
  const id = newId('s')
  return { format: 'hss-show', version: 1, id, name: '', host: '', association: 'IHSA', meets: [blankMeet(id, 1)], patterns: [] }
}

export function blankClass(meet: Meet, division: Division): ShowClass {
  const used = new Set(meet.classes.map((c) => c.id))
  let n = meet.classes.length + 1
  while (used.has(String(n))) n += 1
  return {
    id: String(n),
    class_no: division.class_no,
    name: division.label,
    section: '',
    card_family: division.card_family,
    rule_set: division.rule_set,
    pattern_id: '',
    notes: '',
    entries: [],
  }
}

export function blankPattern(kind: Division['kind']): Pattern {
  return {
    id: newId('p'),
    name: '',
    kind,
    source_page: 0,
    boxes: [1, 2, 3, 4].map((n) => ({ n, abbr: '', label: '', tags: [] })),
  }
}

/** A copy of a pattern from another show, with an id of its own. */
export function copyPattern(pattern: Pattern): Pattern {
  return { ...pattern, id: newId('p'), boxes: pattern.boxes.map((b) => ({ ...b, tags: [...b.tags] })) }
}

/** Patterns in the other shows on this device, one per name, for reuse. */
export function patternLibrary(exceptShowId: string): Pattern[] {
  const seen = new Set<string>()
  const out: Pattern[] = []
  for (const show of allShows()) {
    if (show.id === exceptShowId) continue
    for (const p of show.patterns) {
      const key = p.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/**
 * Boxes from pasted lines, one maneuver per line.
 * "Rr S | LF right, SS right, stop" gives a code and words. A line with no bar is words only.
 * Leading numbers such as "3." or "3)" are dropped.
 */
export function boxesFromLines(text: string): PatternBox[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\s*[.)]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      const bar = line.indexOf('|')
      const abbr = bar >= 0 ? line.slice(0, bar).trim() : ''
      const label = bar >= 0 ? line.slice(bar + 1).trim() : line
      return { n: i + 1, abbr, label, tags: [] }
    })
}

/**
 * Days read again from a workbook keep the ids of the days already in the show,
 * matched by name and then by position. Scores are filed under a day's id, so
 * this is what keeps them with their classes when a sheet is read again.
 */
export function keepMeetIds(before: Meet[], read: Meet[]): Meet[] {
  const used = new Set<string>()
  return read.map((m, i) => {
    const byName = before.find((d) => d.label.trim().toLowerCase() === m.label.trim().toLowerCase())?.id
    const byPlace = before.length === read.length ? before[i].id : undefined
    const id = [byName, byPlace, m.id].find((x): x is string => x !== undefined && !used.has(x)) ?? m.id
    used.add(id)
    return { ...m, id }
  })
}

/** What still stops this show from being saved, in plain words. Empty when it is ready. */
export function problemsIn(show: ShowFile): string[] {
  const problems: string[] = []
  if (show.name.trim() === '') problems.push('Give the show a name.')
  if (show.meets.every((m) => m.classes.length === 0)) problems.push('Add at least one class.')
  const patterns = new Map(show.patterns.map((p) => [p.id, p]))
  for (const meet of show.meets) {
    const day = meet.label.trim() || 'A day'
    if (meet.label.trim() === '') problems.push('Give every day a name, such as Saturday.')
    if (meet.classes.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(meet.date)) problems.push(`${day} needs a date.`)
    const ids = new Set<string>()
    for (const c of meet.classes) {
      const label = c.name.trim() || `Class ${c.id}`
      if (c.name.trim() === '') problems.push(`${day}: class ${c.id} needs a name.`)
      if (ids.has(c.id)) problems.push(`${day}: two classes are numbered ${c.id}.`)
      ids.add(c.id)
      const pattern = patterns.get(c.pattern_id)
      if (!pattern) problems.push(`${day}: choose a pattern for ${label}.`)
    }
  }
  for (const p of show.patterns) {
    const used = show.meets.some((m) => m.classes.some((c) => c.pattern_id === p.id))
    if (!used) continue
    const name = p.name.trim() || 'A pattern'
    if (p.name.trim() === '') problems.push('Give every pattern a name.')
    if (p.boxes.length === 0) problems.push(`${name} has no maneuvers.`)
    else if (p.boxes.some((b) => b.label.trim() === '' && b.abbr.trim() === '')) problems.push(`${name} has a maneuver with no code and no words.`)
  }
  return [...new Set(problems)]
}

/** Tidy a show for saving: trimmed text, boxes numbered in order, tags read from the words, unused patterns dropped. */
export function finishShow(show: ShowFile): ShowFile {
  const usedPatterns = new Set(show.meets.flatMap((m) => m.classes.map((c) => c.pattern_id)))
  return {
    ...show,
    name: show.name.trim(),
    host: show.host.trim(),
    meets: show.meets
      .filter((m) => m.classes.length > 0)
      .map((m) => ({
        ...m,
        label: m.label.trim(),
        // Judges are not part of a show. Each judge types a name on the device they score on.
        judges: [],
        classes: m.classes.map((c) => {
          const division = divisionFor(c.class_no)
          return { ...c, name: c.name.trim(), rule_set: division.rule_set, card_family: division.card_family }
        }),
      })),
    patterns: show.patterns
      .filter((p) => usedPatterns.has(p.id))
      .map((p) => ({
        ...p,
        name: p.name.trim(),
        boxes: p.boxes.map((b, i) => {
          const abbr = b.abbr.trim()
          const label = b.label.trim()
          return { n: i + 1, abbr, label, tags: tagsFor(`${abbr} ${label}`) }
        }),
      })),
  }
}
