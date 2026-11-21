import { useSyncExternalStore } from 'react'
import { cloudCache, setCloudCache } from '../data/cloudShows'
import { classKey, type ShowFile } from '../data/fixture'
import { isShowFile, newId, removeShow as removeLocalShow, saveShow, userShows } from '../data/shows'
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

// ---------------------------------------------------------------------------
// The backend. Loaded only when it is first needed, so the scoring screens do
// not carry the Supabase library.
// ---------------------------------------------------------------------------
let override: CloudBackend | null | undefined
let loading: Promise<CloudBackend | null> | null = null
let started = false
let stopListening: (() => void) | null = null

function serverAddress(): { url: string; key: string } | null {
  // Tests never reach a real server. They hand in a fake with setBackendForTests.
  if (import.meta.env.MODE === 'test') return null
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  return url && key ? { url, key } : null
}

/** Whether this build has a server at all. Known at once, without waiting on anything. */
function isConfigured(): boolean {
  return override !== undefined ? override !== null : serverAddress() !== null
}

/** The backend, for the other server modules. Null when this build has no server. */
export function getBackend(): Promise<CloudBackend | null> {
  return backend()
}

/** Plain words for something the server or the network said. */
export function explainServerError(e: unknown): string {
  return explain(e)
}

async function backend(): Promise<CloudBackend | null> {
  if (override !== undefined) return override
  const at = serverAddress()
  if (!at) return null
  loading ??= import('./supabaseBackend').then((m) => m.createSupabaseBackend(at.url, at.key)).catch(() => null)
  return loading
}

// Who was signed in here last, and whether they could set up shows. It lets a
// show admin open setup at once, and with no signal. It only decides which
// buttons show: the server checks every change for itself.
const ACCOUNT_KEY = 'hss.account.v1'

function remembered(): { user: CloudUser; admin: boolean } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as { user?: CloudUser; admin?: unknown } | null
    if (!parsed || typeof parsed.user?.id !== 'string' || typeof parsed.user?.email !== 'string') return null
    return { user: { id: parsed.user.id, email: parsed.user.email }, admin: parsed.admin === true }
  } catch {
    return null
  }
}

function remember(user: CloudUser, admin: boolean) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ user, admin }))
  } catch {
    // Not worth stopping for.
  }
}

function forget() {
  try {
    localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // Not worth stopping for.
  }
}

function initial(): CloudState {
  const configured = isConfigured()
  const last = configured ? remembered() : null
  return { configured, user: last?.user ?? null, admin: last?.admin ?? false, check: 'never' }
}

let state: CloudState = initial()
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

/**
 * For tests: use this backend, or none. Forgets who was signed in unless told
 * to keep it, which is how a test acts out "the app is opened again".
 */
export function setBackendForTests(fake: CloudBackend | null, keepAccount = false) {
  stopListening?.()
  stopListening = null
  override = fake
  started = false
  if (!keepAccount) forget()
  state = initial()
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
    forget()
    set({ user: null, admin: false })
    return
  }
  const last = remembered()
  set({ user, admin: last?.user.id === user.id ? last.admin : false })
  try {
    const admin = await b.isShowAdmin()
    remember(user, admin)
    if (state.user?.id === user.id) set({ admin })
  } catch {
    // No signal. Keep what was last known about this account.
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
  // In tests there is no real network to ask.
  if (import.meta.env.MODE !== 'test') fetchPagePictures(shows)
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
  forget()
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

/** Only paths this app makes are ever turned into an address, so a show file cannot point a phone anywhere else. */
const PAGE_PATH = /^pages\/[A-Za-z0-9_-]{4,40}\.(jpg|png)$/

/** The address of a pattern's page picture, or null when it has none or this build has no server. */
export function pageImageUrl(path: string | undefined): string | null {
  if (!path || !PAGE_PATH.test(path)) return null
  if (override !== undefined) return override ? override.patternPageUrl(path) : null
  const at = serverAddress()
  return at ? `${at.url}/storage/v1/object/public/pattern-pages/${path}` : null
}

export type PageResult = { ok: true; path: string } | { ok: false; error: string }

/** Store a picture of a pattern book page on the server. Only show admins can. Returns where it was put. */
export async function savePatternPage(image: Blob): Promise<PageResult> {
  const b = await backend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  const path = `pages/${newId('pg')}.${image.type === 'image/png' ? 'png' : 'jpg'}`
  try {
    await b.uploadPatternPage(path, image)
    return { ok: true, path }
  } catch (e) {
    const said = explain(e)
    return { ok: false, error: said === 'This account is not allowed to publish shows.' ? 'This account is not allowed to add pattern pictures.' : said }
  }
}

/**
 * Ask for each page picture of these shows once, so the phone has them when
 * there is no signal. The app's offline worker keeps what comes back.
 */
function fetchPagePictures(shows: ShowFile[]) {
  if (typeof fetch !== 'function') return
  for (const show of shows) {
    for (const pattern of show.patterns) {
      const url = pageImageUrl(pattern.page_image)
      if (url && !asked.has(url)) {
        asked.add(url)
        void fetch(url, { mode: 'no-cors' }).catch(() => asked.delete(url))
      }
    }
  }
}
const asked = new Set<string>()

export type WorkbookResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

/** Have the server fetch a Google Sheet, shared by link, as an Excel file. The sheet is only read. */
export async function fetchWorkbook(link: string): Promise<WorkbookResult> {
  const b = await backend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{25,}/.test(link.trim())) {
    return { ok: false, error: 'That is not a Google Sheets link. Copy it from the address bar while the sheet is open, or from the Share button.' }
  }
  try {
    return { ok: true, bytes: new Uint8Array(await b.fetchWorkbook(link.trim())) }
  } catch (e) {
    return { ok: false, error: explain(e) }
  }
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
