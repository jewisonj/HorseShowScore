import type { Half, Mark } from '../engine'

/**
 * Rule sets are data. Nothing about a class's scale or penalties is hard-coded
 * in the screens.
 *
 * IMPORTANT: none of these is verified yet. The real IHSA score sheets have not
 * been seen. See the decision log, items V12 to V14.
 */
export interface RuleSet {
  id: string
  name: string
  /** Starting score in half points (70 = 140) */
  base: Half
  /** Allowed maneuver scores in half points, low to high */
  boxScale: Half[]
  /** Penalty values offered, in half points */
  penaltyValues: Half[]
  /** Marks offered on the card besides "none" */
  marks: Mark[]
  verified: boolean
  /** Shown to the operator so nobody mistakes a placeholder for the rulebook */
  note: string
}

const SEVEN_STEP: Half[] = [-3, -2, -1, 0, 1, 2, 3] // −1½ to +1½

export const RULE_SETS: Record<string, RuleSet> = {
  'ihsa-reining': {
    id: 'ihsa-reining',
    name: 'IHSA reining',
    base: 140,
    boxScale: SEVEN_STEP,
    penaltyValues: [1, 2, 4, 10], // ½, 1, 2, 5
    marks: ['ZERO'],
    verified: false,
    note: 'Penalty values follow NRHA (½, 1, 2, 5) until the IHSA reining sheet is confirmed. The F&E rider score is not included yet.',
  },
  'ihsa-ranch-riding': {
    id: 'ihsa-ranch-riding',
    name: 'IHSA ranch riding',
    base: 140,
    boxScale: SEVEN_STEP,
    penaltyValues: [2, 6, 10, 20], // 1, 3, 5, 10
    marks: ['OP', 'DQ'],
    verified: false,
    note: 'Penalty values follow the AQHA ranch riding sheet (1, 3, 5, 10) until the IHSA sheet is confirmed.',
  },
  'ihsa-horsemanship': {
    id: 'ihsa-horsemanship',
    name: 'IHSA horsemanship pattern',
    base: 140,
    boxScale: SEVEN_STEP,
    penaltyValues: [6, 10, 20], // 3, 5, 10
    marks: ['OP'],
    verified: false,
    note: 'Pattern scoring here is optional and a placeholder (3, 5, 10). The judge’s placing order is the result.',
  },
}

export function ruleSetFor(id: string): RuleSet {
  const rs = RULE_SETS[id]
  if (!rs) throw new Error(`Unknown rule set: ${id}`)
  return rs
}

/**
 * IHSA horsemanship: what an OP mark does to placing, by class number.
 * Classes 11, 12A, 12B, 13: must place below every rider without one.
 * Classes 14, 16: not placed.
 */
export type OpRule = 'below_clean' | 'not_placed'

export function opRuleForClass(classNo: string): OpRule {
  return classNo === '14' || classNo === '16' ? 'not_placed' : 'below_clean'
}
