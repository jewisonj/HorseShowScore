import { beforeEach, describe, expect, it } from 'vitest'
import { clearCloudCache } from './data/cloudShows'
import { classKey, type Entry, type ShowFile } from './data/fixture'
import { clearShows, saveShow } from './data/shows'
import { loadDraw } from './seed'
import { addRiders, classState, clearAll, getState, removeRun, saveRun, setPlacings } from './store'

const KEY = classKey('s-draw00001-m1', '1')
const entry = (draw: number, back_no: string, rider: string, horse = 'Bay'): Entry => ({ draw, back_no, rider, horse })
const FIRST = [entry(1, '101', 'Avery Example'), entry(2, '102', 'Blake Sample'), entry(3, '103', 'Casey Madeup')]

/** Save the made-up show with this draw, as reading the sheet again and saving would, then load the draw. */
function readSheet(entries: Entry[]) {
  const show: ShowFile = {
    format: 'hss-show',
    version: 1,
    id: 's-draw00001',
    name: 'Made-up show',
    host: '',
    association: 'IHSA',
    meets: [
      {
        id: 's-draw00001-m1',
        label: 'Saturday',
        date: '2027-03-06',
        coach_meeting: '',
        start_time: '',
        judges: [],
        classes: [{ id: '1', class_no: '17', name: 'Open Reining', section: '', card_family: 'pattern', rule_set: 'ihsa-reining', pattern_id: 'p-draw-1', notes: '', entries }],
      },
    ],
    patterns: [{ id: 'p-draw-1', name: 'Made-up pattern', kind: 'reining', source_page: 0, boxes: [1, 2, 3].map((n) => ({ n, abbr: `M${n}`, label: `Maneuver ${n}`, tags: [] })) }],
  }
  saveShow(show)
  loadDraw()
}

const runs = () => classState(getState(), KEY).runs
const backs = () => runs().map((r) => r.backNo)
const run = (backNo: string) => runs().find((r) => r.backNo === backNo)!

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  readSheet(FIRST)
})

describe('reading the sheet again', () => {
  it('keeps every score, penalty and mark exactly as entered', () => {
    saveRun(KEY, { ...run('101'), boxes: [1, -1, 2], penalties: [{ half: 2, box: 1 }], scored: true })
    saveRun(KEY, { ...run('102'), boxes: [3, null, null] })
    const before = JSON.stringify(runs().map(({ updatedAt: _t, ...rest }) => rest))
    readSheet(FIRST)
    readSheet(FIRST)
    expect(JSON.stringify(runs().map(({ updatedAt: _t, ...rest }) => rest))).toBe(before)
  })

  it('adds a rider who was added to the sheet', () => {
    saveRun(KEY, { ...run('101'), boxes: [1, 1, 1], scored: true })
    readSheet([...FIRST, entry(4, '104', 'Devon Invented')])
    expect(backs()).toEqual(['101', '102', '103', '104'])
    expect(run('104').rider).toBe('Devon Invented')
    expect(run('104').boxes).toEqual([null, null, null])
    expect(run('101').boxes).toEqual([1, 1, 1])
  })

  it('drops a rider scratched from the sheet when nothing was entered for them', () => {
    readSheet([FIRST[0], FIRST[2]])
    expect(backs()).toEqual(['101', '103'])
  })

  it('but keeps a scratched rider who already has a score, a rail score or a placing', () => {
    saveRun(KEY, { ...run('102'), boxes: [1, null, null] })
    setPlacings(KEY, [run('103').id])
    readSheet([FIRST[0]])
    expect(backs()).toEqual(['101', '102', '103'])
    expect(classState(getState(), KEY).placings).toEqual([run('103').id])
  })

  it('brings a scratched rider back if the sheet lists them again', () => {
    readSheet([FIRST[0], FIRST[2]])
    readSheet(FIRST)
    expect(backs().sort()).toEqual(['101', '102', '103'])
  })

  it('does not put back a rider taken out by hand on this device', () => {
    removeRun(KEY, run('102').id)
    readSheet(FIRST)
    expect(backs()).toEqual(['101', '103'])
    // Unless that number is added again by hand.
    addRiders(KEY, ['102'], 3)
    removeRun(KEY, run('103').id)
    readSheet(FIRST)
    expect(backs().sort()).toEqual(['101', '102'])
  })

  it('leaves alone a rider added by hand who is not in the sheet', () => {
    addRiders(KEY, ['999'], 3)
    readSheet(FIRST)
    expect(backs()).toContain('999')
  })

  it('updates the order, name and horse of riders still in the draw', () => {
    saveRun(KEY, { ...run('103'), boxes: [2, 2, 2], scored: true })
    readSheet([entry(1, '103', 'Casey Madeup', 'Sorrel'), entry(2, '101', 'Avery Example'), entry(3, '102', 'Blake Sample')])
    expect(run('103').draw).toBe(1)
    expect(run('103').horse).toBe('Sorrel')
    expect(run('103').boxes).toEqual([2, 2, 2])
  })

  it('an empty class in the sheet removes nobody', () => {
    readSheet([])
    expect(backs()).toEqual(['101', '102', '103'])
  })
})
