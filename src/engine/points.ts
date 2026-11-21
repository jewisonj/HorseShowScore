/** IHSA: first through sixth earn 7, 5, 4, 3, 2, 1. */
export const IHSA_POINTS: readonly number[] = [7, 5, 4, 3, 2, 1]

/** Points for a 1-based place. Places past the end of the table earn 0. */
export function pointsForPlace(place: number | null, table: readonly number[] = IHSA_POINTS): number {
  if (place === null || place < 1) return 0
  return table[place - 1] ?? 0
}

/**
 * Team total: the best `countBest` results among the team's designated riders.
 * IHSA Western names up to 7 point riders and counts the best 6.
 */
export function teamTotal(pointRiderPoints: number[], countBest = 6): number {
  return [...pointRiderPoints]
    .sort((a, b) => b - a)
    .slice(0, countBest)
    .reduce((a, b) => a + b, 0)
}
