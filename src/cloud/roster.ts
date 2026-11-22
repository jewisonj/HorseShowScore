import { useSyncExternalStore } from 'react'
import type { RosterRider } from './backend'
import { explainServerError, getBackend } from './cloud'

/**
 * The riders list and the coach's sign-on.
 *
 * The list lives on the server (owner, 2026-11-22): back number, rider, team
 * and the two marks the horse draw works from. Show admins see all of it. A
 * coach signs on with their team's PIN and sees, and marks, their own riders.
 */

const norm = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Bring riders read from a sheet into the list. A back number already there
 * keeps its marks when the name is the same. When the name is different the
 * number belongs to someone else now, so the marks start again. Riders the
 * sheet does not mention are left as they are.
 */
export function mergeRoster(have: RosterRider[], read: { backNo: string; rider: string; team: string }[]): { rows: RosterRider[]; added: number; changed: number; reset: number } {
  const byBack = new Map(have.map((r) => [r.backNo, r]))
  const rows: RosterRider[] = []
  let added = 0
  let changed = 0
  let reset = 0
  for (const r of read) {
    const old = byBack.get(r.backNo)
    const rider = r.rider.replace(/\s+/g, ' ').trim()
    const team = r.team.replace(/\s+/g, ' ').trim()
    if (!old) {
      rows.push({ backNo: r.backNo, rider, team, height: false, group: 1 })
      added++
    } else if (norm(old.rider) !== norm(rider) && old.rider.trim() !== '') {
      rows.push({ backNo: r.backNo, rider, team, height: false, group: 1 })
      if (old.height || old.group !== 1) reset++
      changed++
    } else if (old.rider !== rider || old.team !== team) {
      rows.push({ ...old, rider, team })
      changed++
    }
  }
  return { rows, added, changed, reset }
}

// ---------------------------------------------------------------------------
// A coach, signed on with their team's PIN.
// ---------------------------------------------------------------------------
export interface CoachSeat {
  team: string
  pin: string
}

const STORAGE_KEY = 'hss.coach.v1'

function load(): CoachSeat | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as CoachSeat | null
    return c && typeof c.team === 'string' && typeof c.pin === 'string' ? { team: c.team, pin: c.pin } : null
  } catch {
    return null
  }
}

let coach: CoachSeat | null = load()
const listeners = new Set<() => void>()

function set(next: CoachSeat | null) {
  coach = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The sign-on still holds for this visit.
  }
  listeners.forEach((fn) => fn())
}

export function currentCoach(): CoachSeat | null {
  return coach
}

export function useCoach(): CoachSeat | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    currentCoach,
    currentCoach,
  )
}

export type CoachRiders = { ok: true; team: string; riders: RosterRider[] } | { ok: false; error: string; wrongPin?: boolean }

/** Ask the server for a coach PIN's team and riders. */
async function fetchCoach(pin: string): Promise<CoachRiders> {
  const b = await getBackend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  try {
    const got = await b.coachRiders(pin)
    if (!got) return { ok: false, error: 'That PIN is not a coach PIN.', wrongPin: true }
    return { ok: true, team: got.team, riders: got.riders }
  } catch (e) {
    const said = explainServerError(e)
    return { ok: false, error: /too_many_tries/.test(said) ? 'Too many wrong PINs. Wait ten minutes, then try again.' : said }
  }
}

/** Sign on as a coach. The server says which team the PIN opens. */
export async function coachSignOn(pin: string): Promise<CoachRiders> {
  const digits = pin.trim()
  if (!/^[0-9]{6,8}$/.test(digits)) return { ok: false, error: 'A coach PIN is 6 to 8 digits.' }
  const got = await fetchCoach(digits)
  if (got.ok) set({ team: got.team, pin: digits })
  return got
}

/** The signed-on coach's riders, fresh from the server. A PIN the server no longer takes signs the coach off. */
export async function loadCoachRiders(): Promise<CoachRiders> {
  if (!coach) return { ok: false, error: 'Sign on with your coach PIN.' }
  const got = await fetchCoach(coach.pin)
  if (!got.ok && got.wrongPin) set(null)
  return got
}

/** A coach marks one of their riders. Returns what went wrong, or null. */
export async function coachMark(backNo: string, height: boolean, group: 1 | 2 | 3): Promise<string | null> {
  const b = await getBackend()
  if (!b || !coach) return 'Sign on with your coach PIN.'
  try {
    const said = await b.coachSetMark(coach.pin, backNo, height, group)
    if (said === 'ok') return null
    if (said === 'wrong_pin') {
      set(null)
      return 'This coach PIN is no longer accepted. Ask the show admin for the new one.'
    }
    return 'That rider is not on your team.'
  } catch (e) {
    return explainServerError(e)
  }
}

export function coachSignOff() {
  set(null)
}

/** For tests. */
export function clearCoachForTests() {
  set(null)
}
