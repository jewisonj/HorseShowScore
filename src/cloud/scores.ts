import { cloudCache } from '../data/cloudShows'
import { classKey, type ShowClass, type ShowFile } from '../data/fixture'
import { classResults } from '../results'
import { classState, getState, hasWork, judgeName, watchState, type ClassState } from '../store'
import type { PublicPlacing, PublishedClass, SentRow, SentScores } from './backend'
import { cloudState, explainServerError, getBackend } from './cloud'
import { currentSeat, markSeatRejected } from './seat'

/**
 * Scores going to the server, and placings coming back out.
 *
 *  - A judging device sends each class of a published show as it is scored.
 *    It runs in the background and scoring never waits on it: a send that
 *    fails is tried again later.
 *  - A show admin reads what was sent and publishes a class's placings.
 *  - Anyone reads published placings. A score never leaves the admin's view.
 */

const DEVICE_KEY = 'hss.device.v1'

/** A random id for this device, made once. It tells one judging device's sends from another's. */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY)
    if (have && /^[A-Za-z0-9-]{16,64}$/.test(have)) return have
    const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
    const made = `d-${raw}`.slice(0, 64)
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch {
    return 'd-device-without-storage'
  }
}

/** A class as this device has it, ready to send: everyone placed first, in order, then the rest in draw order. */
export function rowsFor(cs: ClassState, cls: ShowClass): SentRow[] {
  const placed = new Set(cs.placings)
  return classResults(cs, cls).map((row) => ({
    place: row.place,
    tied: row.tied,
    back_no: row.run.backNo,
    rider: row.run.rider ?? '',
    horse: row.run.horse ?? '',
    score: row.score,
    mark: row.run.mark,
    rode: hasWork(row.run) || placed.has(row.run.id),
  }))
}

/**
 * Placings for the public, from what a device sent: place, back number, rider
 * and horse, all the way down. Riders who rode and were not placed follow, with
 * no place. Riders with nothing entered are left out. No score is carried.
 */
export function placingsFrom(rows: SentRow[]): PublicPlacing[] {
  const line = (r: SentRow): PublicPlacing => ({ place: r.place, tied: r.tied, back_no: r.back_no, rider: r.rider, horse: r.horse })
  const placed = rows.filter((r) => r.place !== null).sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
  const rest = rows.filter((r) => r.place === null && r.rode)
  return [...placed.map(line), ...rest.map(line)]
}

// ---------------------------------------------------------------------------
// Sending, on a judging device.
// ---------------------------------------------------------------------------
/** What was last sent for each class, so the same thing is not sent twice. */
const lastSent = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
let sending = false
let stopWatching: (() => void) | null = null

/** The classes of published shows on this device that have something entered and not yet sent. */
function waiting(): { show: ShowFile; key: string; pin: string; judge: string; rows: SentRow[]; finished: boolean; text: string }[] {
  const cache = cloudCache()
  const scores = getState()
  const seat = currentSeat()
  const admin = cloudState().admin
  const out = []
  for (const show of cache.shows) {
    if (!cache.onServer.includes(show.id)) continue
    // Only a judge signed on to this show sends, with their PIN. A signed-in show admin sends with none.
    const judging = seat !== null && seat.role === 'judge' && seat.showId === show.id && !seat.rejected
    if (!judging && !admin) continue
    const pin = judging ? seat.pin : ''
    for (const meet of show.meets) {
      for (const cls of meet.classes) {
        const key = classKey(meet.id, cls.id)
        const cs = classState(scores, key)
        if (!cs.runs.some(hasWork) && cs.placings.length === 0) continue
        let rows: SentRow[]
        try {
          rows = rowsFor(cs, cls)
        } catch {
          // A class whose pattern this device does not have yet. Leave it for later.
          continue
        }
        const finished = cs.finished === true
        const text = JSON.stringify([rows, finished])
        if (lastSent.get(`${show.id}|${key}`) !== text) out.push({ show, key, pin, judge: judgeName(scores, meet.id).trim(), rows, finished, text })
      }
    }
  }
  return out
}

/** Send every class that has changed since it was last sent. Returns how many went. */
export async function sendPendingScores(): Promise<number> {
  if (sending) return 0
  const b = await getBackend()
  if (!b) return 0
  sending = true
  let went = 0
  try {
    for (const item of waiting()) {
      try {
        const said = await b.sendClassScores({ showId: item.show.id, pin: item.pin, classKey: item.key, device: deviceId(), judge: item.judge, rows: item.rows, finished: item.finished })
        if (said === 'ok') {
          lastSent.set(`${item.show.id}|${item.key}`, item.text)
          went++
        } else if (said === 'wrong_pin' && item.pin !== '') {
          // The admin changed the PIN. Scores stay on this device until someone signs on again.
          markSeatRejected()
          break
        }
      } catch {
        // No signal, or the show was taken down. It stays waiting and is tried again.
      }
    }
  } finally {
    sending = false
  }
  return went
}

function soon(ms: number) {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void sendPendingScores().then(() => {
      // Anything that failed, or changed while sending, gets another go.
      if (waiting().length > 0) soon(30_000)
    })
  }, ms)
}

/** Start sending scores in the background. A few seconds after each change, so a card is not sent box by box. */
export function startSendingScores() {
  if (stopWatching) return
  stopWatching = watchState(() => soon(4_000))
  if (typeof window !== 'undefined') window.addEventListener('online', () => soon(1_000))
  soon(4_000)
}

/** For tests: forget what was sent and stop the background sending. */
export function resetScoreSendingForTests() {
  stopWatching?.()
  stopWatching = null
  if (timer) clearTimeout(timer)
  timer = null
  lastSent.clear()
  try {
    localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Nothing to forget.
  }
}

// ---------------------------------------------------------------------------
// The show admin's side.
// ---------------------------------------------------------------------------
export type SentResult = { ok: true; latest: SentScores[] } | { ok: false; error: string }

/** The PIN to give the server for office work on a show: the office seat's, or none for a signed-in show admin. */
function officePin(showId: string): string {
  const seat = currentSeat()
  return seat && seat.role === 'office' && seat.showId === showId ? seat.pin : ''
}

/** The latest send from each device for each class of a show. For the show office and show admins: anyone else gets nothing. */
export async function loadSentScores(showId: string): Promise<SentResult> {
  const b = await getBackend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  try {
    const all = await b.listClassScores(showId, officePin(showId))
    const seen = new Set<string>()
    const latest = all.filter((s) => {
      const k = `${s.classKey}|${s.device}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    return { ok: true, latest }
  } catch (e) {
    return { ok: false, error: explainServerError(e) }
  }
}

/** Publish a class's placings from what a device sent. Returns what went wrong, or null. */
export async function publishPlacings(showId: string, key: string, rows: SentRow[]): Promise<string | null> {
  const b = await getBackend()
  if (!b) return 'This copy of the app is not connected to a server.'
  try {
    const said = await b.publishPlacings(showId, key, placingsFrom(rows), officePin(showId))
    return said === 'ok' ? null : 'The server did not accept this sign-on for publishing. Sign on again as the show office.'
  } catch (e) {
    const said = explainServerError(e)
    return said === 'This account is not allowed to publish shows.' ? 'This account is not allowed to publish placings.' : said
  }
}

export async function takeDownPlacings(showId: string, key: string): Promise<string | null> {
  const b = await getBackend()
  if (!b) return 'This copy of the app is not connected to a server.'
  try {
    const said = await b.removePlacings(showId, key, officePin(showId))
    return said === 'ok' ? null : 'The server did not accept this sign-on. Sign on again as the show office.'
  } catch (e) {
    return explainServerError(e)
  }
}

/** The placings published for a show. Null when the server could not be read. */
export async function loadPlacings(showId: string): Promise<PublishedClass[] | null> {
  const b = await getBackend()
  if (!b) return null
  try {
    return await b.listPlacings(showId)
  } catch {
    return null
  }
}
