import type { ShowClass, ShowFile } from './data/fixture'
import { isReride, type ClassState } from './store'

/**
 * The horses a re-ride can be given, in the order to offer them.
 *
 * `alternates` are the class's alternates that no re-ride in the class has
 * taken yet: the first one is the horse a first re-ride gets. `others` is
 * every other horse in the show, by name. A horse may be used again for a
 * re-ride (owner, 2026-11-22), so nothing is held back from that list.
 */
export function rerideHorses(show: ShowFile | undefined, cls: ShowClass, cs: ClassState): { alternates: string[]; others: string[] } {
  const taken = new Set(cs.runs.filter(isReride).map((r) => r.horse ?? ''))
  const alternates = (cls.alternates ?? []).filter((h) => h && !taken.has(h))
  const all = new Set<string>()
  for (const meet of show?.meets ?? []) {
    for (const c of meet.classes) {
      for (const e of c.entries) if (e.horse.trim()) all.add(e.horse.trim())
      for (const h of c.alternates ?? []) if (h.trim()) all.add(h.trim())
    }
  }
  const others = [...all].filter((h) => !alternates.includes(h)).sort((a, b) => a.localeCompare(b))
  return { alternates, others }
}
