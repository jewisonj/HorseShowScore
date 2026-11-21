import type { Half } from './half'
import type { Mark } from './card'

export interface RankInput {
  id: string
  /** Score in half points. null when not scored or disqualified. */
  score: Half | null
  mark: Mark
}

export interface Ranked {
  id: string
  /** 1-based place, or null when the entry is not placed */
  place: number | null
  /** True when another entry shares this place */
  tied: boolean
}

/**
 * Places for scores, highest first. Equal scores share a place and the next
 * place is skipped: 72, 71, 71, 70, 69 gives 1, 2, 2, 4, 5.
 */
export function shareAndSkip(scores: Half[]): number[] {
  const sorted = [...scores].sort((a, b) => b - a)
  return scores.map((s) => sorted.indexOf(s) + 1)
}

/**
 * Rank a scored class.
 * - Clean rides first, by score.
 * - OP rides after every clean ride, whatever they scored.
 * - ZERO, DQ and unscored entries are not placed.
 * Ties share a place and are flagged so a judge can break them.
 */
export function rankScored(entries: RankInput[]): Ranked[] {
  const clean = entries.filter((e) => e.mark === 'none' && e.score !== null)
  const op = entries.filter((e) => e.mark === 'OP' && e.score !== null)
  const places = new Map<string, number>()

  const cleanPlaces = shareAndSkip(clean.map((e) => e.score as Half))
  clean.forEach((e, i) => places.set(e.id, cleanPlaces[i]))

  const opPlaces = shareAndSkip(op.map((e) => e.score as Half))
  op.forEach((e, i) => places.set(e.id, clean.length + opPlaces[i]))

  const counts = new Map<number, number>()
  for (const p of places.values()) counts.set(p, (counts.get(p) ?? 0) + 1)

  return entries.map((e) => {
    const place = places.get(e.id) ?? null
    return { id: e.id, place, tied: place !== null && (counts.get(place) ?? 0) > 1 }
  })
}
