import { classKey, getPattern, meets } from './data/fixture'
import { addEntries, getState, hasClass } from './store'

/**
 * Put the draw that ships with the test data onto this device.
 *
 * Only classes this device has never touched are filled, so scores already
 * entered are left alone and a rider removed by hand stays removed.
 * Returns how many riders were added.
 */
export function loadDraw(): number {
  let added = 0
  for (const meet of meets) {
    for (const cls of meet.classes) {
      if (cls.entries.length === 0) continue
      const key = classKey(meet.id, cls.id)
      if (hasClass(getState(), key)) continue
      const riders = [...cls.entries]
        .sort((a, b) => a.draw - b.draw)
        .map((e) => ({ backNo: e.back_no, draw: e.draw, horse: e.horse }))
      added += addEntries(key, riders, getPattern(cls.pattern_id).boxes.length)
    }
  }
  return added
}
