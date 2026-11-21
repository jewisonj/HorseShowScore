import { useSyncExternalStore } from 'react'
import type { ShowFile } from './fixture'
import { isShowFile } from './shows'

/**
 * Published shows, as this device last read them from the server.
 * Kept in storage so the list still works with no signal at the arena.
 */
const STORAGE_KEY = 'hss.cloud.v1'

export interface CloudCache {
  shows: ShowFile[]
  /** Ids that were on the server at the last look that worked. */
  onServer: string[]
  /** Shows where this device is keeping an older setup, because the newer one does not fit scores already entered. */
  held: string[]
  /** When the server was last read, as an ISO time. Null if never. */
  checkedAt: string | null
}

const EMPTY: CloudCache = { shows: [], onServer: [], held: [], checkedAt: null }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

function load(): CloudCache {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return EMPTY
    const parsed = JSON.parse(text) as Partial<CloudCache> | null
    if (!parsed || typeof parsed !== 'object') return EMPTY
    return {
      shows: Array.isArray(parsed.shows) ? parsed.shows.filter(isShowFile) : [],
      onServer: strings(parsed.onServer),
      held: strings(parsed.held),
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : null,
    }
  } catch {
    return EMPTY
  }
}

let cache: CloudCache = load()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function cloudCache(): CloudCache {
  return cache
}

export function cloudShows(): ShowFile[] {
  return cache.shows
}

export function useCloudCache(): CloudCache {
  return useSyncExternalStore(subscribe, cloudCache, cloudCache)
}

/** Returns false if the device could not store it. The list on screen is updated either way. */
export function setCloudCache(next: CloudCache): boolean {
  let ok = true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    ok = false
  }
  cache = next
  listeners.forEach((fn) => fn())
  return ok
}

/** For tests. */
export function clearCloudCache() {
  setCloudCache(EMPTY)
}
