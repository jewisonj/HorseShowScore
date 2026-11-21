import type { Half } from './half'

/** How several judges' scores for one run become one class score. */
export type JudgeModel = 'single' | 'sum' | 'drop_high_low' | 'closest_two'

export function sumJudges(scores: Half[]): Half {
  return scores.reduce((a, b) => a + b, 0)
}

/** Five judges: drop one highest and one lowest, add the other three. */
export function dropHighLow(scores: Half[]): Half {
  if (scores.length !== 5) throw new Error('drop_high_low needs exactly 5 judges')
  const s = [...scores].sort((a, b) => a - b)
  return s[1] + s[2] + s[3]
}

/**
 * Three judges (NRCHA option): add the two closest scores and drop the odd one.
 * If the three are evenly spaced, drop the lowest.
 */
export function closestTwo(scores: Half[]): Half {
  if (scores.length !== 3) throw new Error('closest_two needs exactly 3 judges')
  const [lo, mid, hi] = [...scores].sort((a, b) => a - b)
  const lowGap = mid - lo
  const highGap = hi - mid
  if (lowGap < highGap) return lo + mid
  return mid + hi // high pair is closer, or evenly spaced: drop the lowest
}

export function aggregate(model: JudgeModel, scores: Half[]): Half {
  switch (model) {
    case 'single':
      if (scores.length !== 1) throw new Error('single needs exactly 1 judge')
      return scores[0]
    case 'sum':
      return sumJudges(scores)
    case 'drop_high_low':
      return dropHighLow(scores)
    case 'closest_two':
      return closestTwo(scores)
  }
}
