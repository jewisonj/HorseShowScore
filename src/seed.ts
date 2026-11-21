import { classKey, getPattern, meets } from './data/fixture'
import { addEntries, getState, hasClass, updateDetails } from './store'

/**
 * Put the draw that ships with the test data onto this device.
 *
 * A class this device has never touched gets its riders in draw order.
 * A class it has touched keeps its riders and scores as they are: a rider
 * removed by hand stays removed. Riders still in it get their draw position,
 * name and horse brought up to date.
 *
 * Returns how many riders were added.
 */
export function loadDraw(): number {
  let added = 0
  for (const meet of meets) {
    for (const cls of meet.classes) {
      if (cls.entries.length === 0) continue
      const key = classKey(meet.id, cls.id)
      const riders = [...cls.entries]
        .sort((a, b) => a.draw - b.draw)
        .map((e) => ({ backNo: e.back_no, draw: e.draw, rider: e.rider, horse: e.horse }))
      if (hasClass(getState(), key)) updateDetails(key, riders)
      else added += addEntries(key, riders, getPattern(cls.pattern_id).boxes.length)
    }
  }
  return added
}
