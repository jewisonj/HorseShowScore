import type { Half } from './half'

/**
 * Marks change how a run is ranked. They are not point deductions.
 * - OP: off pattern. Keeps its score but ranks below every clean ride.
 * - ZERO: score of 0.
 * - DQ: disqualified, no score.
 */
export type Mark = 'none' | 'OP' | 'ZERO' | 'DQ'

export interface CardInput {
  /** Starting score in half points. 70 is 140. */
  base: Half
  /** One entry per maneuver box. null means not scored yet. */
  boxes: (Half | null)[]
  /**
   * Scores that are added on top of the maneuvers, such as rail work and the
   * F&E rider score on IHSA sheets. null means not scored yet.
   */
  extras?: (Half | null)[]
  /**
   * Penalty values that count, in half points, as positive numbers.
   * A circled penalty (the horse's fault) is left out by the caller.
   */
  penalties: Half[]
  mark?: Mark
}

export interface CardTotal {
  boxSum: Half
  extraSum: Half
  penaltySum: Half
  /** base + boxes + extras - penalties, before any mark is applied */
  arithmetic: Half
  /** The score that counts: 0 for ZERO, null for DQ, otherwise the arithmetic */
  score: Half | null
  /** True when every box and every extra has a score */
  complete: boolean
}

export function cardTotal(input: CardInput): CardTotal {
  let boxSum = 0
  let complete = true
  for (const b of input.boxes) {
    if (b === null) complete = false
    else boxSum += b
  }
  let extraSum = 0
  for (const e of input.extras ?? []) {
    if (e === null) complete = false
    else extraSum += e
  }
  let penaltySum = 0
  for (const p of input.penalties) {
    if (p < 0) throw new Error('Penalties are stored as positive half points')
    penaltySum += p
  }
  const arithmetic = input.base + boxSum + extraSum - penaltySum
  const mark = input.mark ?? 'none'
  const score = mark === 'DQ' ? null : mark === 'ZERO' ? 0 : arithmetic
  return { boxSum, extraSum, penaltySum, arithmetic, score, complete }
}
