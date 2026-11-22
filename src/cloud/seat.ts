import { useSyncExternalStore } from 'react'
import type { SeatRole } from './backend'
import { explainServerError, getBackend } from './cloud'

/**
 * Who this device is signed on as, when it signed on with a PIN: a judge (or
 * scribe), the show office or a steward, for one show. The PIN is kept on the device
 * because the server asks for it with every score sent and every class
 * published. A show admin signs in with an account instead (cloud.ts).
 */
export interface Seat {
  showId: string
  role: SeatRole
  seatNo: number
  pin: string
  /** The server stopped accepting this PIN, for example because the admin changed it. */
  rejected?: boolean
}

const STORAGE_KEY = 'hss.seat.v1'

function load(): Seat | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Seat | null
    if (!s || typeof s.showId !== 'string' || (s.role !== 'judge' && s.role !== 'office' && s.role !== 'steward') || typeof s.seatNo !== 'number' || typeof s.pin !== 'string') return null
    return { showId: s.showId, role: s.role, seatNo: s.seatNo, pin: s.pin, ...(s.rejected ? { rejected: true } : {}) }
  } catch {
    return null
  }
}

let seat: Seat | null = load()
const listeners = new Set<() => void>()

function set(next: Seat | null) {
  seat = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The seat still holds for this visit.
  }
  listeners.forEach((fn) => fn())
}

export function currentSeat(): Seat | null {
  return seat
}

export function useSeat(): Seat | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    currentSeat,
    currentSeat,
  )
}

/** "Judge 2", "Show office" or "Steward". */
export function seatName(s: { role: SeatRole; seatNo: number }): string {
  return s.role === 'office' ? 'Show office' : s.role === 'steward' ? 'Steward' : `Judge ${s.seatNo}`
}

export type SignOnResult = { ok: true; seat: Seat } | { ok: false; error: string }

/** Sign on to a show with a PIN. The server says which seat the PIN opens. */
export async function signOn(showId: string, pin: string): Promise<SignOnResult> {
  const b = await getBackend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  const digits = pin.trim()
  if (!/^[0-9]{4,8}$/.test(digits)) return { ok: false, error: 'A PIN is 4 to 8 digits.' }
  try {
    const found = await b.checkPin(showId, digits)
    if (!found) return { ok: false, error: 'That PIN is not right for this show.' }
    const next: Seat = { showId, role: found.role, seatNo: found.seatNo, pin: digits }
    set(next)
    return { ok: true, seat: next }
  } catch (e) {
    const said = explainServerError(e)
    return { ok: false, error: /too_many_tries/.test(said) ? 'Too many wrong PINs. Wait ten minutes, then try again.' : said }
  }
}

export function signOff() {
  set(null)
}

/** The server would not take this seat's PIN any more. Scoring carries on; sending waits for a new sign-on. */
export function markSeatRejected() {
  if (seat && !seat.rejected) set({ ...seat, rejected: true })
}

/** For tests. */
export function clearSeatForTests() {
  set(null)
}
