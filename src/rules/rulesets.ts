import type { Half, Mark } from '../engine'

/**
 * Rule sets are data. Nothing about a class's scale or penalties is hard-coded
 * in the screens.
 *
 * What is known: the layout of the three IHSA score sheets (reining, ranch
 * riding, horsemanship) was checked against sheets filled in at a real meet on
 * 7 November 2026. That gave the maneuver scales, the rail work box, the F&E
 * box and the off pattern notes.
 *
 * What is not known: penalty values. The IHSA sheets do not list them. The
 * lists below follow the NRHA handbook and the AQHA ranch riding sheet until
 * someone checks them against the IHSA rulebook. See the decision log, V13 and
 * V14. Every rule set stays `verified: false` until then.
 */

/** One listed reason for a penalty of a given value. */
export interface PenaltyReason {
  id: string
  /** Shown on the chip and in the export. Keep it to a few words. */
  short: string
  /** Shown in the list the operator picks from. */
  text: string
  /** Box tags this reason belongs to. Matching reasons are listed first. */
  on?: string[]
}

export interface PenaltyValue {
  /** Value in half points */
  half: Half
  /** May be empty. Then the number is recorded without asking. */
  reasons: PenaltyReason[]
}

/** A score box that is not a maneuver, such as rail work or F&E. */
export interface ExtraBox {
  id: 'rail' | 'fe'
  /** Short heading above the box */
  abbr: string
  label: string
  /** Allowed values in half points, low to high */
  scale: Half[]
  /** True when the value is shown with a plus or minus sign */
  signed: boolean
  hint: string
}

export interface RuleSet {
  id: string
  name: string
  /** Starting score in half points (70 = 140) */
  base: Half
  /** Allowed maneuver scores in half points, low to high */
  boxScale: Half[]
  penalties: PenaltyValue[]
  extras: ExtraBox[]
  /** Marks offered on the card besides "none" */
  marks: Mark[]
  verified: boolean
  /** Shown to the operator so nobody mistakes a placeholder for the rulebook */
  note: string
}

const SEVEN_STEP: Half[] = [-3, -2, -1, 0, 1, 2, 3] // −1½ to +1½
const THIRTEEN_STEP: Half[] = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6] // −3 to +3

/**
 * F&E runs from 0 to 5 and takes half points (owner, 2026-11-22). The judge at
 * the Black Hawk show that day gave halves. Checked the same day: the 2025-26
 * IHSA rulebook does not mention F&E or score increments at all, and the IHSA
 * sheets print only "Excellent (5) Very Good (4) Good (3) Average (0-2)".
 * Nothing says whole points only. Not confirmed with IHSA.
 */
const FE: ExtraBox = {
  id: 'fe',
  abbr: 'F&E',
  label: 'Form and effectiveness',
  scale: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 0 to 5 by halves
  signed: false,
  hint: '5 excellent, 4 very good, 3 good, 0 to 2 average. Half points may be given. Added to the score.',
}

const RAIL: ExtraBox = {
  id: 'rail',
  abbr: 'Rail',
  label: 'Rail work',
  scale: THIRTEEN_STEP,
  signed: true,
  hint: 'The rail work, scored as one maneuver from −3 to +3.',
}

/** NRHA handbook penalties, in our own words. Placeholder for IHSA reining. */
const REINING_PENALTIES: PenaltyValue[] = [
  {
    half: 1,
    reasons: [
      { id: 'spin-eighth', short: 'spin ⅛', text: 'Over or under spin, up to ⅛ turn', on: ['spin'] },
      { id: 'late-change', short: 'late change', text: 'Lead change late by one stride', on: ['lead_change'] },
      { id: 'jog-2', short: 'jog 2 strides', text: 'Jogging up to 2 strides, starting a circle or out of a rollback', on: ['circle', 'rollback'] },
      { id: 'wall', short: 'wall', text: 'Closer than 20 feet to the wall on a stop or rollback', on: ['stop', 'rollback'] },
      { id: 'center', short: 'center', text: 'Closer than 10 feet to the center line on a stop or rollback', on: ['stop', 'rollback'] },
    ],
  },
  {
    half: 2,
    reasons: [
      { id: 'out-of-lead', short: 'out of lead', text: 'Out of lead, each quarter circle', on: ['circle', 'lead_change'] },
      { id: 'spin-quarter', short: 'spin ¼', text: 'Over or under spin, more than ⅛ and up to ¼ turn', on: ['spin'] },
      { id: 'lead-end-1', short: 'lead at end', text: 'Wrong lead around the end, up to halfway', on: ['run'] },
    ],
  },
  {
    half: 4,
    reasons: [
      { id: 'break-gait', short: 'break of gait', text: 'Break of gait' },
      { id: 'freeze', short: 'freeze up', text: 'Freeze up in a spin or rollback', on: ['spin', 'rollback'] },
      { id: 'lead-end-2', short: 'lead at end', text: 'Wrong lead around the end, past halfway', on: ['run'] },
      { id: 'marker', short: 'marker', text: 'Not past the marker before the stop', on: ['stop'] },
      { id: 'jog-more', short: 'jog over 2', text: 'Jogging more than 2 strides, under half a circle', on: ['circle', 'rollback'] },
      { id: 'start', short: 'start', text: 'Start of the pattern: gait before center or the first marker' },
    ],
  },
  {
    half: 10,
    reasons: [
      { id: 'spurring', short: 'spurring', text: 'Spurring in front of the cinch' },
      { id: 'hand', short: 'hand', text: 'Hand used to frighten or praise' },
      { id: 'saddle', short: 'holding saddle', text: 'Holding the saddle' },
      { id: 'disobedience', short: 'disobedience', text: 'Blatant disobedience: kick, bite, buck, rear, strike' },
      { id: 'knees', short: 'knees or hocks', text: 'Horse drops to its knees or hocks' },
    ],
  },
]

/** AQHA ranch riding sheet penalties, in our own words. IHSA uses AQHA rules for this class. */
const RANCH_RIDING_PENALTIES: PenaltyValue[] = [
  {
    half: 2,
    reasons: [
      { id: 'break-walk-trot-2', short: 'break of gait', text: 'Break of gait at walk or trot, 2 strides or less', on: ['walk', 'trot'] },
      { id: 'lead-2', short: 'wrong lead', text: 'Wrong lead or out of lead, 2 strides or less', on: ['lope', 'lead_change'] },
      { id: 'too-slow', short: 'too slow', text: 'Too slow' },
      { id: 'over-bridled', short: 'over-bridled', text: 'Over-bridled' },
      { id: 'out-of-frame', short: 'out of frame', text: 'Out of frame' },
    ],
  },
  {
    half: 6,
    reasons: [
      { id: 'break-walk-trot-more', short: 'break of gait', text: 'Break of gait at walk or trot, more than 2 strides', on: ['walk', 'trot'] },
      { id: 'break-lope', short: 'break at lope', text: 'Break of gait at the lope', on: ['lope'] },
      { id: 'lead-more', short: 'wrong lead', text: 'Wrong lead or out of lead, more than 2 strides', on: ['lope'] },
      { id: 'cross-canter', short: 'cross-canter', text: 'Out of lead or cross-cantering more than 2 strides in a lead change', on: ['lead_change'] },
      { id: 'trot-change', short: 'trot in change', text: 'Trotting more than 3 strides in a simple lead change', on: ['lead_change'] },
      { id: 'trot-departure', short: 'trot departure', text: 'Trotting more than 3 strides in a lope departure or out of a rollback', on: ['lope', 'rollback'] },
      { id: 'obstacle', short: 'obstacle', text: 'Severe disturbance of an obstacle', on: ['obstacle'] },
      { id: 'draped-reins', short: 'draped reins', text: 'Draped reins' },
    ],
  },
  {
    half: 10,
    reasons: [{ id: 'disobedience', short: 'disobedience', text: 'Blatant disobedience: kick, bite, buck, rear. Each refusal' }],
  },
  {
    half: 20,
    reasons: [{ id: 'appearance', short: 'appearance', text: 'Unnatural ranch horse appearance' }],
  },
]

export const RULE_SETS: Record<string, RuleSet> = {
  'ihsa-reining': {
    id: 'ihsa-reining',
    name: 'IHSA reining',
    base: 140,
    boxScale: SEVEN_STEP,
    penalties: REINING_PENALTIES,
    extras: [FE],
    marks: ['DQ', 'ZERO'],
    verified: false,
    note: 'The boxes and F&E follow the IHSA reining sheet. F&E takes half points. Off pattern is a DQ in this class. Penalty values follow NRHA (½, 1, 2, 5) because the IHSA sheet does not list them.',
  },
  'ihsa-ranch-riding': {
    id: 'ihsa-ranch-riding',
    name: 'IHSA ranch riding',
    base: 140,
    boxScale: SEVEN_STEP,
    penalties: RANCH_RIDING_PENALTIES,
    extras: [FE],
    marks: ['OP', 'DQ'],
    verified: false,
    note: 'The boxes and F&E follow the IHSA ranch riding sheet. F&E takes half points. An off pattern ride places below every correct one. Penalty values follow the AQHA sheet (1, 3, 5, 10).',
  },
  'ihsa-horsemanship': {
    id: 'ihsa-horsemanship',
    name: 'IHSA horsemanship pattern',
    base: 140,
    boxScale: THIRTEEN_STEP,
    penalties: [
      { half: 2, reasons: [] },
      { half: 6, reasons: [] },
      { half: 10, reasons: [] },
      { half: 20, reasons: [] },
    ],
    extras: [RAIL, FE],
    marks: ['OP', 'DQ'],
    verified: false,
    note: 'The boxes, rail work and F&E follow the IHSA horsemanship sheet. F&E takes half points. Penalties of 1 and 3 appear on real cards. The full list of values is not confirmed.',
  },
}

export function ruleSetFor(id: string): RuleSet {
  const rs = RULE_SETS[id]
  if (!rs) throw new Error(`Unknown rule set: ${id}`)
  return rs
}

/** The listed reasons for a penalty value, with the ones that fit this box first. */
export function reasonsFor(rules: RuleSet, half: Half, boxTags: string[]): PenaltyReason[] {
  const all = rules.penalties.find((p) => p.half === half)?.reasons ?? []
  const fits = (r: PenaltyReason) => r.on !== undefined && r.on.some((t) => boxTags.includes(t))
  return [...all.filter(fits), ...all.filter((r) => !fits(r))]
}

export function reasonById(rules: RuleSet, half: Half, id: string | undefined): PenaltyReason | undefined {
  if (!id) return undefined
  return rules.penalties.find((p) => p.half === half)?.reasons.find((r) => r.id === id)
}

/**
 * IHSA horsemanship: what an OP mark does to placing, by class number.
 * Classes 11, 12A, 12B, 13: must place below every rider without one.
 * Classes 14, 16: not placed. The sheet for those divisions says off pattern
 * riders are disqualified and cannot place or earn points.
 */
export type OpRule = 'below_clean' | 'not_placed'

export function opRuleForClass(classNo: string): OpRule {
  return classNo === '14' || classNo === '16' ? 'not_placed' : 'below_clean'
}
