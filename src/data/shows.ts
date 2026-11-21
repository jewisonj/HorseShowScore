import { useSyncExternalStore } from 'react'
import type { ShowFile } from './fixture'

/**
 * Shows added on this device: created in setup or opened from a show file.
 * The sample show that ships with the app is not stored here.
 * A show file is plain JSON, so it can be handed from the setup computer to a phone.
 */
const STORAGE_KEY = 'hss.shows.v1'

export function isShowFile(value: unknown): value is ShowFile {
  const s = value as ShowFile | null
  return (
    s !== null &&
    typeof s === 'object' &&
    s.format === 'hss-show' &&
    s.version === 1 &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    Array.isArray(s.meets) &&
    Array.isArray(s.patterns)
  )
}

function load(): ShowFile[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter(isShowFile) : []
  } catch {
    return []
  }
}

let shows: ShowFile[] = load()
const listeners = new Set<() => void>()

function commit(next: ShowFile[]): boolean {
  let ok = true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    ok = false
  }
  shows = next
  listeners.forEach((fn) => fn())
  return ok
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function userShows(): ShowFile[] {
  return shows
}

export function useUserShows(): ShowFile[] {
  return useSyncExternalStore(subscribe, userShows, userShows)
}

/** Add a show, or replace the one with the same id. Returns false if the device could not store it. */
export function saveShow(show: ShowFile): boolean {
  return commit([...shows.filter((s) => s.id !== show.id), show])
}

export function removeShow(id: string): boolean {
  return commit(shows.filter((s) => s.id !== id))
}

/** For tests. */
export function clearShows() {
  commit([])
}

/** Read a show file's text. Returns null when it is not a show file. */
export function readShowFile(text: string): ShowFile | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isShowFile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function newId(prefix: string): string {
  const c = globalThis.crypto
  const raw = c && typeof c.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `${prefix}-${raw.replace(/-/g, '').slice(0, 10)}`
}
