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
}

export interface Run {
  id: string
  backNo: string
  boxes: (Half | null)[]
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
}

export interface AppState {
  v: 1
  classes: Record<string, ClassState>
}

const STORAGE_KEY = 'hss.state.v1'
const EMPTY: AppState = { v: 1, classes: {} }
const EMPTY_CLASS: ClassState = { runs: [], placings: [] }

function load(): AppState {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return EMPTY
    const parsed = JSON.parse(text) as AppState
    if (parsed?.v !== 1 || typeof parsed.classes !== 'object') return EMPTY
    return parsed
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

/** Add riders by back number. Numbers already in the class are skipped. Returns how many were added. */
export function addRiders(key: string, backNos: string[], boxCount: number): number {
  let added = 0
  updateClass(key, (c) => {
    const have = new Set(c.runs.map((r) => r.backNo))
    const fresh: Run[] = []
    for (const backNo of backNos) {
      if (have.has(backNo)) continue
      have.add(backNo)
      fresh.push({
        id: newId(),
        backNo,
        boxes: Array.from({ length: boxCount }, () => null),
        penalties: [],
        mark: 'none',
        scored: false,
        updatedAt: Date.now(),
      })
    }
    added = fresh.length
    return fresh.length ? { ...c, runs: [...c.runs, ...fresh] } : c
  })
  return added
}

export function saveRun(key: string, run: Run) {
  updateClass(key, (c) => ({
    ...c,
    runs: c.runs.map((r) => (r.id === run.id ? { ...run, updatedAt: Date.now() } : r)),
  }))
}

export function removeRun(key: string, runId: string) {
  updateClass(key, (c) => ({
    runs: c.runs.filter((r) => r.id !== runId),
    placings: c.placings.filter((id) => id !== runId),
  }))
}

export function setPlacings(key: string, placings: string[]) {
  updateClass(key, (c) => ({ ...c, placings }))
}

export function clearAll() {
  commit(EMPTY)
}

/** Replace everything on this device with a backup. Returns false if the text is not a backup. */
export function restoreBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as AppState
    if (parsed?.v !== 1 || typeof parsed.classes !== 'object') return false
    commit(parsed)
    return true
  } catch {
    return false
  }
}
