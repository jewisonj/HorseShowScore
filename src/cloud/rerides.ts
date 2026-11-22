import { useEffect, useSyncExternalStore } from 'react'
import type { RerideAsk } from './backend'
import { cloudState, explainServerError, getBackend } from './cloud'
import { currentSeat, markSeatRejected } from './seat'

/**
 * Re-rides a steward has asked the judge for.
 *
 * A steward's device sends the ask. Every device signed on to the show, and a
 * show admin, looks for them every so often while a screen that shows them is
 * open. A judge approves or denies. The judge's own re-ride, called with nobody
 * asking, never comes through here: it happens on the judge's device.
 *
 * Scoring never waits on any of this. A look that fails leaves what was there.
 */

const EVERY_MS = 15_000
const PENDING_KEY = 'hss.rerides.v1'

interface Pending {
  showId: string
  id: string
  approve: boolean
}

interface AsksState {
  showId: string | null
  asks: RerideAsk[]
  /** The last look could not reach the server. */
  failed: boolean
}

let state: AsksState = { showId: null, asks: [], failed: false }
const listeners = new Set<() => void>()

function set(next: AsksState) {
  state = next
  listeners.forEach((fn) => fn())
}

function loadPending(): Pending[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as Pending[]).filter((p) => p && typeof p.showId === 'string' && typeof p.id === 'string' && typeof p.approve === 'boolean') : []
  } catch {
    return []
  }
}

function savePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list))
  } catch {
    // The answer still shows on this device. It is sent the next time the list is kept.
  }
}

/** The PIN to use for a show: the signed-on seat's, an empty one for a show admin, or null when this device is neither. */
function pinFor(showId: string): string | null {
  const seat = currentSeat()
  if (seat && seat.showId === showId && !seat.rejected) return seat.pin
  return cloudState().admin ? '' : null
}

/** What this device has decided and not yet got to the server shows as decided here at once. */
function withPending(showId: string, asks: RerideAsk[]): RerideAsk[] {
  const mine = loadPending().filter((p) => p.showId === showId)
  if (mine.length === 0) return asks
  return asks.map((a) => {
    const p = mine.find((x) => x.id === a.id)
    return p && a.status === 'asked' ? { ...a, status: p.approve ? 'approved' : 'denied' } : a
  })
}

/** Send the answers this device gave that have not arrived yet. */
async function flush(showId: string, pin: string): Promise<void> {
  const b = await getBackend()
  if (!b) return
  for (const p of loadPending().filter((x) => x.showId === showId)) {
    try {
      const said = await b.decideReride(showId, pin, p.id, p.approve)
      if (said === 'wrong_pin') {
        markSeatRejected()
        return
      }
      // Arrived, or someone else answered first, or it is gone: either way it is no longer waiting.
      savePending(loadPending().filter((x) => !(x.showId === p.showId && x.id === p.id)))
    } catch {
      return
    }
  }
}

/** Look at the server once for a show's asks. */
export async function refreshRerideAsks(showId: string): Promise<void> {
  const pin = pinFor(showId)
  const b = await getBackend()
  if (pin === null || !b) {
    if (state.showId !== showId) set({ showId, asks: [], failed: false })
    return
  }
  try {
    await flush(showId, pin)
    const got = await b.listRerideAsks(showId, pin)
    if (got === 'wrong_pin') {
      // The PIN was changed. Stop asking with it: every wrong try counts against this address.
      markSeatRejected()
      set({ showId, asks: [], failed: false })
      return
    }
    set({ showId, asks: withPending(showId, got), failed: false })
  } catch {
    set({ showId, asks: state.showId === showId ? state.asks : [], failed: true })
  }
}

/** The asks of a show, kept up to date while the screen using this is open. */
export function useRerideAsks(showId: string | undefined): { asks: RerideAsk[]; failed: boolean } {
  const s = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
    () => state,
  )
  useEffect(() => {
    if (!showId) return
    void refreshRerideAsks(showId)
    const timer = setInterval(() => void refreshRerideAsks(showId), EVERY_MS)
    return () => clearInterval(timer)
  }, [showId])
  return showId && s.showId === showId ? { asks: s.asks, failed: s.failed } : { asks: [], failed: false }
}

/** A steward asks for a re-ride. Returns what went wrong in plain words, or null when the ask is in. */
export async function askForReride(showId: string, classKey: string, backNo: string, reason: string): Promise<string | null> {
  const pin = pinFor(showId)
  const b = await getBackend()
  if (!b) return 'This copy of the app is not connected to a server.'
  if (pin === null) return 'Sign on as a steward to ask for a re-ride.'
  try {
    const said = await b.askReride(showId, pin, classKey, backNo, reason.trim())
    if (said === 'ok') {
      await refreshRerideAsks(showId)
      return null
    }
    if (said === 'already_asked') return 'A re-ride is already asked for this rider. The judge has not answered yet.'
    if (said === 'not_published') return 'This show is not on the server any more.'
    if (said === 'too_many') return 'Too many re-rides have been asked for today. Tell the show admin.'
    if (currentSeat()?.showId === showId) return 'This PIN cannot ask for a re-ride. Sign on with the steward PIN.'
    return 'This account cannot ask for a re-ride.'
  } catch (e) {
    return explainServerError(e)
  }
}

/**
 * The judge's answer to an ask. It shows on this device at once and is sent
 * in the background, again later if it does not arrive.
 */
export async function answerRerideAsk(showId: string, id: string, approve: boolean): Promise<void> {
  savePending([...loadPending().filter((p) => !(p.showId === showId && p.id === id)), { showId, id, approve }])
  if (state.showId === showId) set({ ...state, asks: withPending(showId, state.asks) })
  const pin = pinFor(showId)
  if (pin !== null) await flush(showId, pin)
}

/** For tests. */
export function resetRerideAsksForTests() {
  savePending([])
  set({ showId: null, asks: [], failed: false })
}
