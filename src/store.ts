import { useSyncExternalStore } from 'react'
import type { Half, Mark } from './engine'

/**
 * Phase 0 storage: everything lives on this device, in localStorage.
 * Every change is written before the screen updates, so a reload, a crash or
 * a dead battery loses nothing. There is no server sync yet.
 */

export interface Penalty {
  /** Value in half points, positive */
  half: Half
  /** 0-based index of the maneuver box it was called in */
  box: number
  /** Id of the listed reason in the rule set, when the operator picked one */
  reason?: string
  /**
   * Circled on the card: put down to the horse, not the rider.
   * It stays on the card but is not counted in the score.
   */
  circled?: boolean
}

export interface Run {
  id: string
  backNo: string
  /** Position in the draw, when the rider came from a draw */
  draw?: number
  /** The rider's name, when known */
  rider?: string
  /** The drawn horse, when known */
  horse?: string
  boxes: (Half | null)[]
  /** Scores outside the maneuvers, by box id: 'rail', 'fe'. Missing means not scored. */
  extras: Record<string, Half | null>
  penalties: Penalty[]
  mark: Mark
  /** True once the operator has saved a score for this rider */
  scored: boolean
  updatedAt: number
}

export interface ClassState {
  runs: Run[]
  /** Run ids in the judge's placing order, first place first */
  placings: string[]
  /** Back numbers taken out of this class by hand on this device. The draw does not put them back. */
  removed?: string[]
}

export interface AppState {
  v: 2
  classes: Record<string, ClassState>
  /** Who is judging each day, as typed on this device. Keyed by meet id. Never sent to the server. */
  judges?: Record<string, string>
}

export const STORAGE_KEY = 'hss.state.v2'
const EMPTY: AppState = { v: 2, classes: {} }
const EMPTY_CLASS: ClassState = { runs: [], placings: [] }

function isState(value: unknown): value is AppState {
  const s = value as AppState | null
  return s !== null && typeof s === 'object' && s.v === 2 && typeof s.classes === 'object' && s.classes !== null
}

function load(): AppState {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return EMPTY
    const parsed: unknown = JSON.parse(text)
    return isState(parsed) ? parsed : EMPTY
  } catch {
    return EMPTY
  }
}

let state: AppState = load()
/** Set when the last write to storage failed, so the screen can say so. */
let saveFailed = false
const listeners = new Set<() => void>()

function commit(next: AppState) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    saveFailed = false
  } catch {
    saveFailed = true
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Be told after every change to the scores on this device. Returns a function that stops it. */
export function watchState(fn: () => void): () => void {
  return subscribe(fn)
}

export function getState(): AppState {
  return state
}

export function didSaveFail(): boolean {
  return saveFailed
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function useSaveFailed(): boolean {
  return useSyncExternalStore(subscribe, didSaveFail, didSaveFail)
}

export function classState(s: AppState, key: string): ClassState {
  return s.classes[key] ?? EMPTY_CLASS
}

/** True when this class has been touched on this device, even if it is empty now. */
export function hasClass(s: AppState, key: string): boolean {
  return s.classes[key] !== undefined
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function updateClass(key: string, fn: (c: ClassState) => ClassState) {
  const current = classState(state, key)
  commit({ ...state, classes: { ...state.classes, [key]: fn(current) } })
}

/** Split "214 187, 302" into back numbers. Keeps letters, e.g. 12A. */
export function parseBackNumbers(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0)
}

export interface NewRider {
  backNo: string
  draw?: number
  rider?: string
  horse?: string
}

function blankRun(rider: NewRider, boxCount: number): Run {
  return {
    id: newId(),
    backNo: rider.backNo,
    ...(rider.draw !== undefined ? { draw: rider.draw } : {}),
    ...(rider.rider ? { rider: rider.rider } : {}),
    ...(rider.horse ? { horse: rider.horse } : {}),
    boxes: Array.from({ length: boxCount }, () => null),
    extras: {},
    penalties: [],
    mark: 'none',
    scored: false,
    updatedAt: Date.now(),
  }
}

/**
 * Add riders to a class. A back number already in the class is skipped.
 * Returns how many were added.
 */
export function addEntries(key: string, riders: NewRider[], boxCount: number): number {
  let added = 0
  updateClass(key, (c) => {
    const have = new Set(c.runs.map((r) => r.backNo))
    const fresh: Run[] = []
    for (const rider of riders) {
      if (have.has(rider.backNo)) continue
      have.add(rider.backNo)
      fresh.push(blankRun(rider, boxCount))
    }
    added = fresh.length
    return fresh.length ? { ...c, runs: [...c.runs, ...fresh] } : c
  })
  return added
}

/**
 * Bring the draw details (order, rider, horse) of riders already in a class up to date.
 * Matched by back number. Scores, penalties and placings are not touched.
 * Returns how many riders changed.
 */
export function updateDetails(key: string, riders: NewRider[]): number {
  const byBack = new Map(riders.map((r) => [r.backNo, r]))
  let changed = 0
  const current = classState(state, key)
  const runs = current.runs.map((run) => {
    const d = byBack.get(run.backNo)
    if (!d) return run
    if (run.draw === d.draw && (run.rider ?? '') === (d.rider ?? '') && (run.horse ?? '') === (d.horse ?? '')) return run
    changed += 1
    const { draw: _draw, rider: _rider, horse: _horse, ...rest } = run
    return {
      ...rest,
      ...(d.draw !== undefined ? { draw: d.draw } : {}),
      ...(d.rider ? { rider: d.rider } : {}),
      ...(d.horse ? { horse: d.horse } : {}),
    }
  })
  if (changed > 0) commit({ ...state, classes: { ...state.classes, [key]: { ...current, runs } } })
  return changed
}

/** Add riders by back number alone, by hand. A number taken out by hand earlier is welcome back. */
export function addRiders(key: string, backNos: string[], boxCount: number): number {
  const added = addEntries(
    key,
    backNos.map((backNo) => ({ backNo })),
    boxCount,
  )
  const current = classState(state, key)
  if (current.removed?.some((b) => backNos.includes(b))) {
    updateClass(key, (c) => ({ ...c, removed: (c.removed ?? []).filter((b) => !backNos.includes(b)) }))
  }
  return added
}

/**
 * Bring a class this device already has in line with the draw.
 *
 *  - A rider new to the draw is added, unless this device took that back number out by hand.
 *  - A rider who came from the draw, is no longer in it, and has nothing entered is dropped.
 *    One with a score, penalty, mark or placing stays.
 *  - A rider added here by hand is left alone.
 *  - Everyone still in the draw gets their order, name and horse brought up to date.
 *
 * Nothing that was entered is ever changed or removed. Returns how many riders were added.
 */
export function syncDraw(key: string, riders: NewRider[], boxCount: number): number {
  const current = classState(state, key)
  const inDraw = new Set(riders.map((r) => r.backNo))
  const removed = new Set(current.removed ?? [])
  const placed = new Set(current.placings)
  const kept = current.runs.filter((r) => inDraw.has(r.backNo) || r.draw === undefined || hasWork(r) || placed.has(r.id))
  const have = new Set(kept.map((r) => r.backNo))
  const fresh: Run[] = []
  for (const rider of riders) {
    if (have.has(rider.backNo) || removed.has(rider.backNo)) continue
    have.add(rider.backNo)
    fresh.push(blankRun(rider, boxCount))
  }
  if (fresh.length > 0 || kept.length !== current.runs.length) {
    updateClass(key, (c) => ({ ...c, runs: [...kept, ...fresh] }))
  }
  updateDetails(key, riders)
  return fresh.length
}

export function saveRun(key: string, run: Run) {
  updateClass(key, (c) => ({
    ...c,
    runs: c.runs.map((r) => (r.id === run.id ? { ...run, updatedAt: Date.now() } : r)),
  }))
}

export function removeRun(key: string, runId: string) {
  updateClass(key, (c) => {
    const gone = c.runs.find((r) => r.id === runId)
    return {
      ...c,
      runs: c.runs.filter((r) => r.id !== runId),
      placings: c.placings.filter((id) => id !== runId),
      // Remember it, so reading the draw again does not put this rider back.
      ...(gone ? { removed: [...new Set([...(c.removed ?? []), gone.backNo])] } : {}),
    }
  })
}

/** True when a run holds anything the operator entered. */
export function hasWork(run: Run): boolean {
  return (
    run.scored ||
    run.boxes.some((b) => b !== null) ||
    Object.values(run.extras ?? {}).some((v) => v !== null) ||
    run.penalties.length > 0 ||
    run.mark !== 'none'
  )
}

/**
 * Give untouched riders in a class a card with a different number of boxes,
 * after its pattern changed in setup. Returns false, changing nothing, if any
 * rider already has work on a card of another size.
 */
export function resizeRuns(key: string, boxCount: number): boolean {
  const current = classState(state, key)
  if (current.runs.every((r) => r.boxes.length === boxCount)) return true
  if (current.runs.some((r) => r.boxes.length !== boxCount && hasWork(r))) return false
  const runs = current.runs.map((r) => (r.boxes.length === boxCount ? r : { ...r, boxes: Array.from({ length: boxCount }, () => null) }))
  commit({ ...state, classes: { ...state.classes, [key]: { ...current, runs } } })
  return true
}

/** Forget everything entered for these classes, when their show is removed from the device. */
export function removeClassStates(keys: string[]) {
  const classes = { ...state.classes }
  for (const key of keys) delete classes[key]
  commit({ ...state, classes })
}

export function setPlacings(key: string, placings: string[]) {
  updateClass(key, (c) => ({ ...c, placings }))
}

/** The judge's name typed on this device for a day. Empty when none. */
export function judgeName(s: AppState, meetId: string): string {
  return s.judges?.[meetId] ?? ''
}

export function setJudgeName(meetId: string, name: string) {
  commit({ ...state, judges: { ...state.judges, [meetId]: name.slice(0, 80) } })
}

export function clearAll() {
  commit(EMPTY)
}

/** Replace everything on this device with a backup. Returns false if the text is not a backup. */
export function restoreBackup(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isState(parsed)) return false
    commit(parsed)
    return true
  } catch {
    return false
  }
}
