import { cardTotal, pointsForPlace, rankScored, type CardTotal } from './engine'
import { classKey, getPattern, meets, type Meet, type ShowClass } from './data/fixture'
import { opRuleForClass, reasonById, ruleSetFor } from './rules/rulesets'
import { classState, type AppState, type ClassState, type Run } from './store'

export function totalFor(run: Run, cls: ShowClass): CardTotal {
  const rs = ruleSetFor(cls.rule_set)
  return cardTotal({
    base: rs.base,
    boxes: run.boxes,
    extras: rs.extras.map((e) => run.extras?.[e.id] ?? null),
    // A circled penalty is put down to the horse. It stays on the card but does not count.
    penalties: run.penalties.filter((p) => !p.circled).map((p) => p.half),
    mark: run.mark,
  })
}

/** "3:1 break of gait; 7:3 (circled)" for the export: maneuver number, value, reason. */
export function penaltyDetail(run: Run, cls: ShowClass): string {
  const rs = ruleSetFor(cls.rule_set)
  return run.penalties
    .slice()
    .sort((a, b) => a.box - b.box)
    .map((p) => {
      const reason = reasonById(rs, p.half, p.reason)
      return `${p.box + 1}:${p.half / 2}${reason ? ` ${reason.short}` : ''}${p.circled ? ' (circled)' : ''}`
    })
    .join('; ')
}

export interface ResultRow {
  run: Run
  /** 1-based place, or null when not placed */
  place: number | null
  tied: boolean
  /** Score in half points when the rider has a saved score */
  score: number | null
  penaltySum: number
  points: number
}

/** A scored pattern class: places come from the scores. */
export function patternClassResults(cs: ClassState, cls: ShowClass): ResultRow[] {
  const scored = cs.runs.filter((r) => r.scored)
  const totals = new Map(scored.map((r) => [r.id, totalFor(r, cls)]))
  const ranked = rankScored(
    scored.map((r) => ({ id: r.id, score: totals.get(r.id)!.score, mark: r.mark })),
  )
  const rows: ResultRow[] = ranked.map((rk) => {
    const run = scored.find((r) => r.id === rk.id)!
    const t = totals.get(run.id)!
    return {
      run,
      place: rk.place,
      tied: rk.tied,
      score: t.score,
      penaltySum: t.penaltySum,
      points: pointsForPlace(rk.place),
    }
  })
  return rows.sort((a, b) => (a.place ?? 999) - (b.place ?? 999) || a.run.backNo.localeCompare(b.run.backNo))
}

/** A placings class: the judge's order is the result. Scores only support it. */
export function placingsClassResults(cs: ClassState, cls: ShowClass): ResultRow[] {
  const byId = new Map(cs.runs.map((r) => [r.id, r]))
  return cs.placings
    .map((id) => byId.get(id))
    .filter((r): r is Run => r !== undefined)
    .map((run, i) => {
      const t = run.scored ? totalFor(run, cls) : null
      return {
        run,
        place: i + 1,
        tied: false,
        score: t ? t.score : null,
        penaltySum: t ? t.penaltySum : 0,
        points: pointsForPlace(i + 1),
      }
    })
}

/**
 * Warnings for a placings class when an OP rider is placed where the rule
 * does not allow. The judge's call still stands. This only points it out.
 */
export function placingWarnings(cs: ClassState, cls: ShowClass): string[] {
  const byId = new Map(cs.runs.map((r) => [r.id, r]))
  const placed = cs.placings.map((id) => byId.get(id)).filter((r): r is Run => r !== undefined)
  const warnings: string[] = []
  const rule = opRuleForClass(cls.class_no)
  if (rule === 'not_placed') {
    for (const r of placed) {
      if (r.mark === 'OP') warnings.push(`#${r.backNo} is marked OP. In this class an OP rider is not placed.`)
    }
  } else {
    const firstOp = placed.findIndex((r) => r.mark === 'OP')
    if (firstOp >= 0) {
      const cleanAfter = placed.slice(firstOp + 1).filter((r) => r.mark !== 'OP')
      const unplacedClean = cs.runs.filter((r) => r.mark !== 'OP' && !cs.placings.includes(r.id))
      if (cleanAfter.length > 0) {
        warnings.push(`#${placed[firstOp].backNo} is marked OP but is placed above a rider without one.`)
      } else if (unplacedClean.length > 0 && placed.length < 6) {
        warnings.push(`#${placed[firstOp].backNo} is marked OP. Riders without an OP should place first.`)
      }
    }
  }
  return warnings
}

export function classResults(cs: ClassState, cls: ShowClass): ResultRow[] {
  return cls.card_family === 'pattern' ? patternClassResults(cs, cls) : placingsClassResults(cs, cls)
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Half points as a plain decimal for spreadsheets: 141 -> 70.5 */
function halfToDecimal(h: number | null): string {
  return h === null ? '' : (h / 2).toString()
}

export const CSV_HEADER = [
  'meet',
  'date',
  'judge',
  'show_class',
  'class_no',
  'class',
  'pattern',
  'draw',
  'back_number',
  'horse',
  'placing',
  'score',
  'rail_work',
  'fe',
  'penalty_total',
  'penalties',
  'mark',
  'points',
  'status',
]

/** Every rider in every class, placed or not. Status is always unverified in this prototype. */
export function resultsCsv(state: AppState, meetList: Meet[] = meets): string {
  const lines = [CSV_HEADER.join(',')]
  for (const meet of meetList) {
    for (const cls of meet.classes) {
      const cs = classState(state, classKey(meet.id, cls.id))
      if (cs.runs.length === 0) continue
      const placedRows = classResults(cs, cls)
      const placedIds = new Set(placedRows.map((r) => r.run.id))
      const rest: ResultRow[] = cs.runs
        .filter((r) => !placedIds.has(r.id))
        .map((run) => {
          const t = run.scored ? totalFor(run, cls) : null
          return { run, place: null, tied: false, score: t ? t.score : null, penaltySum: t ? t.penaltySum : 0, points: 0 }
        })
      for (const row of [...placedRows, ...rest]) {
        lines.push(
          [
            meet.label,
            meet.date,
            meet.judges.join(' / '),
            cls.id,
            cls.class_no,
            cls.name,
            getPattern(cls.pattern_id).name,
            row.run.draw ?? null,
            row.run.backNo,
            row.run.horse ?? '',
            row.place,
            halfToDecimal(row.score),
            row.run.scored ? halfToDecimal(row.run.extras?.rail ?? null) : '',
            row.run.scored ? halfToDecimal(row.run.extras?.fe ?? null) : '',
            row.run.scored ? halfToDecimal(row.penaltySum) : '',
            row.run.scored ? penaltyDetail(row.run, cls) : '',
            row.run.mark === 'none' ? '' : row.run.mark,
            row.place === null ? '' : row.points,
            'unverified',
          ]
            .map(csvCell)
            .join(','),
        )
      }
    }
  }
  return lines.join('\n') + '\n'
}
