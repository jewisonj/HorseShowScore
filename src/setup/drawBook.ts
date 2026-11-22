import { useSyncExternalStore } from 'react'
import type { WeightGroup } from './horseDraw'

/**
 * What the horse draw works from, kept on the setup computer only.
 *
 * A rider's height mark and weight group are personal data about a student
 * (decision D-25). They are never put in a show, never published, never sent
 * to the server and never exported. Only the result of the draw, rider and
 * horse, goes into the show. The horses' limits and the horses set for each
 * class stay here too: a published show needs none of it.
 */
const STORAGE_KEY = 'hss.drawbook.v1'

export interface BookHorse {
  name: string
  /** Who provides the horse, when the show's sheet says. It tells two barns' horses of the same name apart on the horses list. */
  provider?: string
  takesHeight: boolean
  /** The heaviest weight group this horse carries. */
  maxGroup: WeightGroup
}

export interface RiderMark {
  height: boolean
  group: WeightGroup
}

export interface DrawBook {
  horses: BookHorse[]
  /** By back number. A rider with no entry is not a height rider and is in group 1. */
  riders: Record<string, RiderMark>
  /** The horses set for each class, by class key (meet id and class id). */
  sets: Record<string, string[]>
  /**
   * For a class whose horses came from the show's sheet: the horse in each draw
   * place, first place first, empty where a place has none. Riders are then
   * drawn onto the places, so the sheet's own order of horses is kept.
   */
  places?: Record<string, string[]>
  /** The alternates the sheet lists for such a class. */
  alts?: Record<string, string[]>
}

const EMPTY: DrawBook = { horses: [], riders: {}, sets: {} }

function isBook(value: unknown): value is DrawBook {
  const b = value as DrawBook | null
  return b !== null && typeof b === 'object' && Array.isArray(b.horses) && typeof b.riders === 'object' && b.riders !== null && typeof b.sets === 'object' && b.sets !== null
}

function load(): Record<string, DrawBook> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, DrawBook] => isBook(e[1])))
  } catch {
    return {}
  }
}

let books: Record<string, DrawBook> = load()
const listeners = new Set<() => void>()

function commit(next: Record<string, DrawBook>): boolean {
  let ok = true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    ok = false
  }
  books = next
  listeners.forEach((fn) => fn())
  return ok
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function drawBook(showId: string): DrawBook {
  return books[showId] ?? EMPTY
}

export function useDrawBook(showId: string): DrawBook {
  return useSyncExternalStore(
    subscribe,
    () => drawBook(showId),
    () => drawBook(showId),
  )
}

/** Returns false if this computer could not store it. */
export function saveDrawBook(showId: string, book: DrawBook): boolean {
  return commit({ ...books, [showId]: book })
}

/** Forget a show's draw book, when the show is removed from this computer. */
export function forgetDrawBook(showId: string) {
  if (!(showId in books)) return
  const next = { ...books }
  delete next[showId]
  commit(next)
}

export const NO_MARK: RiderMark = { height: false, group: 1 }

/** A rider's marks, or the default: not a height rider, group 1, fits any horse. */
export function markOf(book: DrawBook, backNo: string): RiderMark {
  return book.riders[backNo] ?? NO_MARK
}

/**
 * Add horses by name, with their provider where it is known. A name already in
 * the book, in any letter case, is not added again, but takes the provider if
 * it had none. Returns how many were added.
 */
export function addHorses(book: DrawBook, items: (string | { name: string; provider?: string })[]): { book: DrawBook; added: number } {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()
  const horses = book.horses.map((h) => ({ ...h }))
  let added = 0
  let changed = false
  for (const item of items) {
    const name = tidy(typeof item === 'string' ? item : item.name)
    const provider = tidy(typeof item === 'string' ? '' : (item.provider ?? ''))
    if (!name) continue
    const have = horses.find((h) => h.name.trim().toLowerCase() === name.toLowerCase())
    if (have) {
      if (provider && !have.provider) {
        have.provider = provider
        changed = true
      }
      continue
    }
    horses.push({ name, ...(provider ? { provider } : {}), takesHeight: true, maxGroup: 3 })
    added++
  }
  return { book: added > 0 || changed ? { ...book, horses } : book, added }
}

/** For tests. */
export function clearDrawBooks() {
  commit({})
}
