import { useSyncExternalStore } from 'react'
import { cloudCache, setCloudCache } from '../data/cloudShows'
import { classKey, type ShowFile } from '../data/fixture'
import { isShowFile, removeShow as removeLocalShow, saveShow, userShows } from '../data/shows'
import { loadDraw } from '../seed'
import { classState, getState, hasWork } from '../store'
import type { CloudBackend, CloudUser } from './backend'

/**
 * The server side of the app: who is signed in, and the published shows.
 *
 * Scoring never waits on any of this. Everything here runs in the background
 * and the app carries on with what the device already has when it fails.
 */
export interface CloudState {
  /** False when this build has no server address. */
  configured: boolean
  user: CloudUser | null
  /** The signed-in person may set up and publish shows. */
  admin: boolean
  /** How the last look at the server went. */
  check: 'never' | 'checking' | 'ok' | 'failed'
}

let state: CloudState = { configured: false, user: null, admin: false, check: 'never' }
const listeners = new Set<() => void>()

function set(patch: Partial<CloudState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function cloudState(): CloudState {
  return state
}

export function useCloud(): CloudState {
  return useSyncExternalStore(subscribe, cloudState, cloudState)
}

// ---------------------------------------------------------------------------
// The backend. Loaded only when it is first needed, so the scoring screens do
// not carry the Supabase library.
// ---------------------------------------------------------------------------
let override: CloudBackend | null | undefined
let loading: Promise<CloudBackend | null> | null = null
let started = false
let stopListening: (() => void) | null = null

async function backend(): Promise<CloudBackend | null> {
  if (override !== undefined) return override
  // Tests never reach a real server. They hand in a fake with setBackendForTests.
  if (import.meta.env.MODE === 'test') return null
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  if (!url || !key) return null
  loading ??= import('./supabaseBackend').then((m) => m.createSupabaseBackend(url, key)).catch(() => null)
  return loading
}

/** For tests: use this backend, or none. Also forgets who was signed in. */
export function setBackendForTests(fake: CloudBackend | null) {
  stopListening?.()
  stopListening = null
  override = fake
  started = false
  state = { configured: false, user: null, admin: false, check: 'never' }
  listeners.forEach((fn) => fn())
}

function explain(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return 'Could not reach the server. Check the connection and try again.'
  }
  if (/row-level security|permission denied/i.test(text)) return 'This account is not allowed to publish shows.'
  return text
}

async function learnUser(b: CloudBackend, user: CloudUser | null) {
  if (!user) {
    set({ user: null, admin: false })
    return
  }
  set({ user })
  try {
    const admin = await b.isShowAdmin()
    if (state.user?.id === user.id) set({ admin })
  } catch {
    // Offline, or the database is not set up yet. Publishing stays hidden until this works.
    if (state.user?.id === user.id) set({ admin: false })
  }
}

/** Find out who is signed in and read the published shows. Safe to call more than once. */
export async function startCloud(): Promise<void> {
  if (started) return
  started = true
  const b = await backend()
  if (!b) return
  set({ configured: true })
  stopListening = b.onUserChange((user) => {
    if (user?.id !== state.user?.id) void learnUser(b, user)
  })
  try {
    await learnUser(b, await b.user())
  } catch {
    // Carry on signed out.
  }
  await refreshShows()
}

/** True when this device holds any entered score, penalty or mark for the show. */
function showHasWork(show: ShowFile): boolean {
  const scores = getState()
  return show.meets.some((m) => m.classes.some((c) => classState(scores, classKey(m.id, c.id)).runs.some(hasWork)))
}

/** True when the show gives a class a different number of maneuvers than rides already scored here have. */
function clashesWithScores(show: ShowFile): boolean {
  const scores = getState()
  for (const meet of show.meets) {
    for (const cls of meet.classes) {
      const pattern = show.patterns.find((p) => p.id === cls.pattern_id)
      if (!pattern) continue
      const runs = classState(scores, classKey(meet.id, cls.id)).runs
      if (runs.some((r) => r.boxes.length !== pattern.boxes.length && hasWork(r))) return true
    }
  }
  return false
}

let lastRefresh = 0

/**
 * Read the published shows from the server and keep them on this device.
 * Returns false when the server could not be read; the device keeps what it had.
 */
export async function refreshShows(): Promise<boolean> {
  const b = await backend()
  if (!b) return false
  set({ configured: true, check: 'checking' })
  lastRefresh = Date.now()
  let rows: unknown[]
  try {
    rows = await b.listShows()
  } catch {
    set({ check: 'failed' })
    return false
  }
  const before = cloudCache()
  const old = new Map(before.shows.map((s) => [s.id, s]))
  const fresh = rows.filter(isShowFile)
  const ids = new Set(fresh.map((s) => s.id))
  const held: string[] = []
  const shows = fresh.map((show) => {
    const had = old.get(show.id)
    // A newer setup that changes the box count under scores already entered: keep the one they were scored with.
    if (had && clashesWithScores(show) && !clashesWithScores(had)) {
      held.push(show.id)
      return had
    }
    return show
  })
  // A show taken off the server stays on a device that has scores for it.
  const kept = before.shows.filter((s) => !ids.has(s.id) && showHasWork(s))
  setCloudCache({ shows: [...shows, ...kept], onServer: [...ids], held, checkedAt: new Date().toISOString() })
  loadDraw()
  set({ check: 'ok' })
  return true
}

/** Refresh, unless the server was read in the last minute. */
export function refreshShowsIfStale() {
  if (Date.now() - lastRefresh > 60_000) void refreshShows()
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const b = await backend()
  if (!b) return 'This copy of the app is not connected to a server.'
  let problem: string | null
  try {
    problem = await b.signIn(email.trim(), password)
  } catch (e) {
    return explain(e)
  }
  if (problem) return problem
  await learnUser(b, await b.user())
  return null
}

export async function signOut(): Promise<void> {
  const b = await backend()
  if (!b) return
  try {
    await b.signOut()
  } catch {
    // Signed out on this device either way.
  }
  set({ user: null, admin: false })
}

/**
 * Put a show on the server, or replace the one there. Every device then reads
 * this copy, so the copy that was being worked on here is no longer needed.
 * Returns what went wrong, or null.
 */
export async function publishShow(given: ShowFile): Promise<string | null> {
  const b = await backend()
  if (!b) return 'This copy of the app is not connected to a server.'
  // Judges' names never go to the server, even from a show file made before that rule.
  const show: ShowFile = { ...given, meets: given.meets.map((m) => ({ ...m, judges: [] })) }
  try {
    await b.publishShow(show)
  } catch (e) {
    return explain(e)
  }
  const cache = cloudCache()
  const stored = setCloudCache({
    ...cache,
    shows: [...cache.shows.filter((s) => s.id !== show.id), show],
    onServer: [...new Set([...cache.onServer, show.id])],
    held: cache.held.filter((id) => id !== show.id),
  })
  if (stored) removeLocalShow(show.id)
  loadDraw()
  return null
}

/** Take a show off the server. This device keeps its own copy of the setup. */
export async function takeOffServer(show: ShowFile): Promise<string | null> {
  const b = await backend()
  if (!b) return 'This copy of the app is not connected to a server.'
  try {
    await b.removeShow(show.id)
  } catch (e) {
    return explain(e)
  }
  if (!userShows().some((s) => s.id === show.id)) saveShow(show)
  const cache = cloudCache()
  setCloudCache({
    ...cache,
    shows: cache.shows.filter((s) => s.id !== show.id),
    onServer: cache.onServer.filter((id) => id !== show.id),
    held: cache.held.filter((id) => id !== show.id),
  })
  return null
}

/** The largest pattern book the reader takes. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export type ReadResult = { ok: true; found: unknown } | { ok: false; error: string }

/** Send a pattern book to the reader on the server. Only show admins get an answer. */
export async function readPatternBook(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ReadResult> {
  const b = await backend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  if (file.size > MAX_PDF_BYTES) {
    return { ok: false, error: 'That file is larger than 8 MB. Save just the pattern pages as their own PDF and try again.' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Every PDF starts with %PDF-
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { ok: false, error: 'That file is not a PDF.' }
  }
  try {
    return { ok: true, found: await b.readPatternBook(toBase64(bytes)) }
  } catch (e) {
    return { ok: false, error: explain(e) }
  }
}

/** Two copies of a show hold the same thing. The server may hand fields back in another order. */
export function sameShow(a: ShowFile, b: ShowFile): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
