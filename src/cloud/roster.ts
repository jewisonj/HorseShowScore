import { useSyncExternalStore } from 'react'
import { STARTING_PIN, type RosterRider } from './backend'
import { explainServerError, getBackend } from './cloud'

/**
 * The riders list and the coach's sign-on.
 *
 * The list lives on the server (owner, 2026-11-22): back number, rider, team
 * and the two marks the horse draw works from. Show admins see all of it. A
 * coach signs on with their team and its PIN and sees, and marks, their own riders.
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
// A coach, signed on with their team and its PIN.
//
// Every coach begins on the same starting PIN (owner, 2026-11-22), so a coach
// says which team they are. The starting PIN opens one thing: choosing their
// own PIN. Nothing of the team is shown until they have.
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

export type CoachRiders =
  /** `horses`: the names of the horses the coach's own school provides. */
  | { ok: true; team: string; riders: RosterRider[]; horses: string[] }
  /** `choosePin`: the PIN was the starting one, and the coach has to choose their own before anything is shown. */
  | { ok: false; error: string; wrongPin?: boolean; choosePin?: boolean }

const TOO_MANY = 'Too many wrong PINs. Wait ten minutes, then try again.'
const tooMany = (said: string) => (/too_many_tries/.test(said) ? TOO_MANY : said)

/** The teams whose coach may sign on, for a coach to pick theirs. */
export async function coachTeams(): Promise<{ ok: true; teams: string[] } | { ok: false; error: string }> {
  const b = await getBackend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  try {
    return { ok: true, teams: await b.coachTeams() }
  } catch (e) {
    return { ok: false, error: explainServerError(e) }
  }
}

/** Ask the server for a team's riders with its coach's PIN. */
async function fetchCoach(team: string, pin: string): Promise<CoachRiders> {
  const b = await getBackend()
  if (!b) return { ok: false, error: 'This copy of the app is not connected to a server.' }
  try {
    const got = await b.coachRiders(team, pin)
    if (got === 'change_pin') return { ok: false, error: 'Choose your own PIN first.', choosePin: true }
    if (!got) return { ok: false, error: `That is not the coach PIN for ${team}.`, wrongPin: true }
    return { ok: true, team: got.team, riders: got.riders, horses: got.horses }
  } catch (e) {
    return { ok: false, error: tooMany(explainServerError(e)) }
  }
}

/** Sign on as the coach of a team. With the starting PIN the answer is `choosePin`, and the coach is not signed on yet. */
export async function coachSignOn(team: string, pin: string): Promise<CoachRiders> {
  if (team.trim() === '') return { ok: false, error: 'Pick your team.' }
  const digits = pin.trim()
  if (!/^[0-9]{4,8}$/.test(digits)) return { ok: false, error: 'A coach PIN is 4 to 8 digits.' }
  const got = await fetchCoach(team, digits)
  if (got.ok) set({ team: got.team, pin: digits })
  return got
}

/**
 * A coach chooses their own PIN. `current` is the PIN they have now, which the
 * first time is the starting PIN. On success the coach is signed on with the
 * new one. Returns what went wrong, or null.
 */
export async function coachChoosePin(team: string, current: string, next: string): Promise<string | null> {
  if (!/^[0-9]{4,8}$/.test(next)) return 'A PIN is 4 to 8 digits.'
  if (next === STARTING_PIN) return 'Choose a PIN other than the one you started with.'
  const b = await getBackend()
  if (!b) return 'This copy of the app is not connected to a server.'
  try {
    const said = await b.coachChangePin(team, current, next)
    if (said === 'ok') {
      set({ team, pin: next })
      return null
    }
    if (said === 'bad_pin') return 'That PIN cannot be used. Choose 4 to 8 digits, and not the one you started with.'
    if (coach?.team === team) set(null)
    return 'The PIN you signed on with is no longer accepted. Sign on again.'
  } catch (e) {
    return tooMany(explainServerError(e))
  }
}

/** The signed-on coach's riders, fresh from the server. A PIN the server no longer takes signs the coach off. */
export async function loadCoachRiders(): Promise<CoachRiders> {
  if (!coach) return { ok: false, error: 'Sign on as a coach.' }
  const got = await fetchCoach(coach.team, coach.pin)
  if (!got.ok && (got.wrongPin || got.choosePin)) set(null)
  return got
}

/** A coach marks one of their riders. Returns what went wrong, or null. */
export async function coachMark(backNo: string, height: boolean, group: 1 | 2 | 3): Promise<string | null> {
  const b = await getBackend()
  if (!b || !coach) return 'Sign on as a coach.'
  try {
    const said = await b.coachSetMark(coach.team, coach.pin, backNo, height, group)
    if (said === 'ok') return null
    if (said === 'wrong_pin') {
      set(null)
      return 'Your coach PIN is no longer accepted. Sign on again. If it still fails, ask the show admin to put your team back on the starting PIN.'
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
