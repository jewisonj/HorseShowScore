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
  /** One entry per box. null means not scored yet. */
  boxes: (Half | null)[]
  /** Penalty values in half points, as positive numbers. */
  penalties: Half[]
  mark?: Mark
}

export interface CardTotal {
  boxSum: Half
  penaltySum: Half
  /** base + boxes - penalties, before any mark is applied */
  arithmetic: Half
  /** The score that counts: 0 for ZERO, null for DQ, otherwise the arithmetic */
  score: Half | null
  /** True when every box has a score */
  complete: boolean
}

export function cardTotal(input: CardInput): CardTotal {
  let boxSum = 0
  let complete = true
  for (const b of input.boxes) {
    if (b === null) complete = false
    else boxSum += b
  }
  let penaltySum = 0
  for (const p of input.penalties) {
    if (p < 0) throw new Error('Penalties are stored as positive half points')
    penaltySum += p
  }
  const arithmetic = input.base + boxSum - penaltySum
  const mark = input.mark ?? 'none'
  const score = mark === 'DQ' ? null : mark === 'ZERO' ? 0 : arithmetic
  return { boxSum, penaltySum, arithmetic, score, complete }
}
