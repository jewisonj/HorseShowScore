import { allShows, classKey, findPattern } from './data/fixture'
import { addEntries, getState, hasClass, resizeRuns, syncDraw } from './store'

/**
 * Put the draw of every show this device knows onto this device.
 *
 * A class this device has never seen gets its riders in draw order.
 * A class it already has is brought in line with the draw: riders new to the
 * draw are added, riders gone from it are dropped if nothing was entered for
 * them, and everyone else gets their order, name and horse brought up to date.
 * A rider taken out by hand stays out. Nothing that was entered is changed.
 *
 * Returns how many riders were added.
 */
export function loadDraw(): number {
  let added = 0
  for (const meet of allShows().flatMap((s) => s.meets)) {
    for (const cls of meet.classes) {
      if (cls.entries.length === 0) continue
      const pattern = findPattern(cls.pattern_id)
      if (!pattern) continue
      const key = classKey(meet.id, cls.id)
      const riders = [...cls.entries]
        .sort((a, b) => a.draw - b.draw)
        .map((e) => ({ backNo: e.back_no, draw: e.draw, rider: e.rider, horse: e.horse }))
      if (hasClass(getState(), key)) {
        // A pattern that gained or lost a maneuver: rides with nothing entered yet follow it.
        resizeRuns(key, pattern.boxes.length)
        added += syncDraw(key, riders, pattern.boxes.length)
      } else added += addEntries(key, riders, pattern.boxes.length)
    }
  }
  return added
}
