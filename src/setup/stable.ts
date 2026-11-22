import type { StableHorse } from '../cloud/backend'
import type { BookHorse } from './drawBook'

/**
 * Matching a show's horses to the horses list on the server, where a horse's
 * limits are kept from show to show. A horse is its name and who provides it.
 */
const norm = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The list's row for a horse of a show: the same name and provider. When either
 * side has no provider and the list has only one horse of that name, that one.
 */
export function findStable(list: StableHorse[], horse: { name: string; provider?: string }): StableHorse | undefined {
  const named = list.filter((s) => norm(s.name) === norm(horse.name))
  const exact = named.find((s) => norm(s.provider) === norm(horse.provider))
  if (exact) return exact
  if (named.length === 1 && (norm(horse.provider) === '' || norm(named[0].provider) === '')) return named[0]
  return undefined
}

/** A show's horse with the limits the list has for it, when it has any. */
export function withListLimits(list: StableHorse[] | null, horse: BookHorse): BookHorse {
  const on = list ? findStable(list, horse) : undefined
  return on ? { ...horse, takesHeight: on.takesHeight, maxGroup: on.maxGroup, byClass: on.byClass ?? {} } : horse
}

/** The row to save for a show's horse: over the row it matches, or a new one under its own name and provider. */
export function stableRow(list: StableHorse[], horse: BookHorse): StableHorse {
  const on = findStable(list, horse)
  // A row saved before the provider was known is replaced by one that names the provider.
  const provider = on && norm(on.provider) !== '' ? on.provider : (horse.provider ?? '').replace(/\s+/g, ' ').trim()
  return { name: on ? on.name : horse.name, provider, takesHeight: horse.takesHeight, maxGroup: horse.maxGroup, byClass: horse.byClass ?? {} }
}
