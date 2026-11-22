import { beforeEach, describe, expect, it } from 'vitest'
import { allShows, builtInShows, classKey, getClass, getMeet, getPattern, showOfMeet, type ShowFile, type Meet } from '../data/fixture'
import { clearShows, readShowFile, saveShow, userShows } from '../data/shows'
import { sheetPlacings } from '../results'
import { loadDraw } from '../seed'
import { classState, clearAll, getState, resizeRuns, saveRun, setPlacings } from '../store'
import { dateIn, inferDivision, nextDay, sectionOf, tagsFor, titleCase } from './build'
import { blankShow, boxesFromLines, copyPattern, finishShow, keepMeetIds, mergeSheetRead, patternLibrary, problemsIn } from './draft'
import { sampleShowWorkbook } from './testWorkbook'
import { readHorseList, readShowWorkbook } from './workbook'
import { readXlsx } from './xlsx'

beforeEach(() => {
  clearAll()
  clearShows()
})

/** A finished show built from the sample workbook, with patterns borrowed from the sample show. */
function springShow(): ShowFile {
  const draft = blankShow()
  const read = readShowWorkbook(readXlsx(sampleShowWorkbook()), draft.id)
  const reining = copyPattern(getPattern('nrha-8'))
  const hms = copyPattern(getPattern('hms-t'))
  const ranch = copyPattern(getPattern('aqha-rr-10'))
  const pick = (classNo: string) => (classNo === '17' ? reining.id : classNo === '15' ? ranch.id : hms.id)
  return finishShow({
    ...draft,
    name: read.title,
    host: 'Example College',
    meets: read.meets.map((m) => ({ ...m, classes: m.classes.map((c) => ({ ...c, pattern_id: pick(c.class_no) })) })),
    patterns: [reining, hms, ranch],
  })
}

describe('reading a sheet again into a show that is already set up', () => {
  const day = (id: string, label: string): Meet => ({ id, label, date: '', coach_meeting: '', start_time: '', judges: [], classes: [] })

  it('keeps the ids of the days it already has, so scores stay with their classes', () => {
    // The sample Saturday show files its scores under "meet-5". A sheet read into it must not change that.
    expect(keepMeetIds([day('meet-5', 'Saturday')], [day('evt-m1', 'saturday ')]).map((m) => m.id)).toEqual(['meet-5'])
    // Matched by name first, whatever the order.
    expect(keepMeetIds([day('a', 'Saturday'), day('b', 'Sunday')], [day('x1', 'Sunday'), day('x2', 'Saturday')]).map((m) => m.id)).toEqual(['b', 'a'])
    // Then by position, when the names changed but the number of days did not.
    expect(keepMeetIds([day('a', 'Day 1')], [day('x1', 'Saturday')]).map((m) => m.id)).toEqual(['a'])
    // A day the show never had gets the id it was read with, and no id is used twice.
    expect(keepMeetIds([day('a', 'Saturday')], [day('x1', 'Saturday'), day('x2', 'Sunday')]).map((m) => m.id)).toEqual(['a', 'x2'])
    expect(keepMeetIds([day('a', 'Saturday'), day('b', 'Saturday')], [day('x1', 'Saturday'), day('x2', 'Saturday')]).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('reads the show\'s horses from the workbook, each once', () => {
    expect(readHorseList(readXlsx(sampleShowWorkbook()))).toEqual(['Rocket', 'Archie (Roan)', 'Super Pete', "O'Malley", 'Duke & Daisy', 'Spare'])
  })

  it('keeps the riders a show already has when the sheet has none for that class yet', () => {
    // Sunday's show holds the riders from the program. Its sheet is up, but the draw is not typed in yet.
    const sunday = builtInShows.find((s) => s.id === 'evt-bhc-2026-11-22')!
    const emptySheet: Meet[] = [
      { ...sunday.meets[0], id: 'read-m1', classes: sunday.meets[0].classes.map((c) => ({ ...c, pattern_id: '', entries: [] })) },
    ]
    const { meets, kept } = mergeSheetRead(sunday.meets, emptySheet)
    expect(meets[0].id).toBe('meet-6')
    expect(kept).toHaveLength(12)
    expect(meets[0].classes.map((c) => c.entries.length)).toEqual(sunday.meets[0].classes.map((c) => c.entries.length))
    expect(meets[0].classes.map((c) => c.pattern_id)).toEqual(sunday.meets[0].classes.map((c) => c.pattern_id))

    // Once the sheet has a class's draw, the sheet's riders are the ones used.
    const drawn = emptySheet[0].classes.map((c, i) => (i === 0 ? { ...c, entries: [{ draw: 1, back_no: '7', rider: 'A Rider', horse: 'Dot' }] } : c))
    const second = mergeSheetRead(sunday.meets, [{ ...emptySheet[0], classes: drawn }])
    expect(second.kept).toHaveLength(11)
    expect(second.meets[0].classes[0].entries).toEqual([{ draw: 1, back_no: '7', rider: 'A Rider', horse: 'Dot' }])
  })
})

describe('the sample shows that ship with the app', () => {
  it('are one show per day, each with only its own classes and patterns', () => {
    expect(builtInShows.map((s) => [s.id, s.name, s.meets.map((m) => `${m.id} ${m.label} ${m.date}`)])).toEqual([
      ['evt-bhc-2026-11-21', 'IHSA Western Show, November 21', ['meet-5 Saturday 2026-11-21']],
      ['evt-bhc-2026-11-22', 'IHSA Western Show, November 22', ['meet-6 Sunday 2026-11-22']],
    ])
    for (const show of builtInShows) {
      const used = new Set(show.meets.flatMap((m) => m.classes.map((c) => c.pattern_id)))
      expect(show.patterns.map((p) => p.id).sort()).toEqual([...used].sort())
    }
    // No pattern is in both shows, so pattern ids stay unique across shows.
    const all = builtInShows.flatMap((s) => s.patterns.map((p) => p.id))
    expect(new Set(all).size).toBe(all.length)
    // The days kept their ids, so scores already on a device stay with their classes.
    expect(showOfMeet('meet-5')?.id).toBe('evt-bhc-2026-11-21')
    expect(showOfMeet('meet-6')?.id).toBe('evt-bhc-2026-11-22')
  })
})

describe('reading a class name', () => {
  it('finds the division, telling Level II from Level I', () => {
    const no = (name: string) => inferDivision(name).class_no
    expect(no('Reining')).toBe('17')
    expect(no('Ranch Riding')).toBe('15')
    expect(no('Open Horsemanship')).toBe('16')
    expect(no('Level II Horsemanship, Sec. B')).toBe('14')
    expect(no('Level I Horsemanship, Sec. A')).toBe('13')
    expect(no('Rookie B Horsemanship, Sec. C')).toBe('12B')
    expect(no('Rookie A Horsemanship')).toBe('12A')
    expect(no('Beginner Horsemanship')).toBe('11')
    expect(inferDivision('Level II Horsemanship').card_family).toBe('placings')
    expect(inferDivision('Reining').rule_set).toBe('ihsa-reining')
  })

  it('finds the section, the date and tidy horse names', () => {
    expect(sectionOf('Rookie B Horsemanship, Sec. C')).toBe('C')
    expect(sectionOf('Level I Section A')).toBe('A')
    expect(sectionOf('Reining')).toBe('')
    expect(dateIn('November 21, 2026 IHSA Western Show')).toBe('2026-11-21')
    expect(dateIn('Nov. 7 2026')).toBe('2026-11-07')
    expect(dateIn('Spring show')).toBe('')
    expect(nextDay('2026-11-30')).toBe('2026-12-01')
    expect(titleCase('ARCHIE (ROAN)')).toBe('Archie (Roan)')
    expect(titleCase("O'MALLEY")).toBe("O'Malley")
  })

  it('tags a maneuver from its words so fitting penalties come first', () => {
    expect(tagsFor('4 LS 4 spins left')).toEqual(['spin'])
    expect(tagsFor('S&B Stop, back')).toEqual(['stop', 'backup'])
    expect(tagsFor('RRB Stop, RBR')).toEqual(['rollback', 'stop'])
    expect(tagsFor('Rr S LF right, SS right, stop')).toEqual(['circle', 'stop'])
    expect(tagsFor('Col, CL Collect, change leads')).toEqual(['lead_change', 'lope'])
    expect(tagsFor('W/Os Walk logs')).toEqual(['walk', 'obstacle'])
  })
})

describe('reading the show workbook', () => {
  const wb = readXlsx(sampleShowWorkbook())

  it('opens an Excel file and reads values, not formulas', () => {
    expect(wb.sheetNames).toContain('Class List')
    expect(wb.cell('Class List', 'B3')).toBe('Reining')
    expect(wb.cell('Class List', 'A3')).toBe(1)
    expect(wb.cell('Reining', 'E6')).toBe(501)
    expect(wb.cell('Reining', 'H7')).toBe('ARCHIE (ROAN)') // split across formatting runs in the file
    expect(wb.cell('Ranch Riding', 'H6')).toBe('DUKE & DAISY')
    expect(wb.cell('Reining', 'H9')).toBe(false)
    expect(wb.cell('Reining', 'Z99')).toBeNull()
    expect(wb.cell('No such tab', 'A1')).toBeNull()
  })

  it('rejects a file that is not a workbook', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow('not an Excel workbook')
  })

  it('builds the days, the classes in running order and the draw', () => {
    const show = readShowWorkbook(wb, 's-x')
    expect(show.title).toBe('March 6, 2027 Spring Western Show')
    expect(show.rides).toBe(6)
    expect(show.meets.map((m) => [m.id, m.label, m.date, m.judges])).toEqual([
      // The workbook names a judge for each day. Judges' names are left out of shows.
      ['s-x-m1', 'Saturday', '2027-03-06', []],
      ['s-x-m2', 'Sunday', '2027-03-07', []],
    ])
    expect(show.meets[0].classes.map((c) => [c.id, c.name, c.class_no, c.section, c.card_family, c.entries.length])).toEqual([
      ['1', 'Reining', '17', '', 'pattern', 2],
      ['2', 'Level I Horsemanship, Sec. A', '13', 'A', 'placings', 3],
      ['3', 'Level II Horsemanship', '14', '', 'placings', 0],
    ])
    expect(show.meets[0].classes[0].entries).toEqual([
      { draw: 1, back_no: '501', rider: 'Ada Able', horse: 'Rocket' },
      { draw: 2, back_no: '502', rider: 'Ben Baker', horse: 'Archie (Roan)' },
    ])
    // The totals row is not a class. Gaps are pointed out, not guessed at.
    expect(show.meets[1].classes.map((c) => c.name)).toEqual(['Ranch Riding', 'Rookie B Horsemanship'])
    expect(show.notes).toEqual(['"Level II Horsemanship" has no riders yet.', '"Rookie B Horsemanship" is in the class list but has no tab of its own, so it has no riders.'])
  })

  it('says so when the workbook is some other spreadsheet', () => {
    expect(() => readShowWorkbook({ sheetNames: ['Budget'], hasSheet: () => false, cell: () => null }, 's-x')).toThrow('Class List')
  })
})

describe('setting up a show', () => {
  it('turns pasted lines into boxes', () => {
    expect(boxesFromLines('1. W | Walk\n2) Extended trot\n\n  S&B | Stop, back ')).toEqual([
      { n: 1, abbr: 'W', label: 'Walk', tags: [] },
      { n: 2, abbr: '', label: 'Extended trot', tags: [] },
      { n: 3, abbr: 'S&B', label: 'Stop, back', tags: [] },
    ])
  })

  it('lists what is missing, in plain words, and nothing when the show is ready', () => {
    const draft = blankShow()
    expect(problemsIn(draft)).toEqual(['Give the show a name.', 'Add at least one class.'])
    const read = readShowWorkbook(readXlsx(sampleShowWorkbook()), draft.id)
    const half = { ...draft, name: 'Spring show', meets: read.meets.map((m, i) => (i === 1 ? { ...m, date: '' } : m)) }
    expect(problemsIn(half)).toContain('Saturday: choose a pattern for Reining.')
    expect(problemsIn(half)).toContain('Sunday needs a date.')
    expect(problemsIn(springShow())).toEqual([])
  })

  it('finishes a show: unused patterns dropped, boxes numbered and tagged', () => {
    const show = springShow()
    expect(show.patterns).toHaveLength(3)
    expect(show.patterns[0].boxes.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(show.patterns[0].boxes[0].tags).toEqual(['spin'])
    expect(new Set(show.patterns.map((p) => p.id)).size).toBe(3)
    expect(show.patterns.every((p) => !builtInShows.some((s) => s.patterns.some((b) => b.id === p.id)))).toBe(true)
  })

  it('offers the patterns of other shows for reuse, one per name', () => {
    const names = patternLibrary('some-new-show').map((p) => p.name)
    expect(names).toContain('NRHA Reining Pattern 17')
    expect(names).toHaveLength(12)
    saveShow(springShow())
    expect(patternLibrary('some-new-show')).toHaveLength(12) // the copies share names with the originals
  })
})

describe('shows on this device', () => {
  it('a saved show is found by its days and classes, beside the sample show', () => {
    const show = springShow()
    expect(saveShow(show)).toBe(true)
    expect(allShows().map((s) => s.id)).toEqual([...builtInShows.map((s) => s.id), show.id])
    const meet = show.meets[0]
    expect(getMeet(meet.id)?.label).toBe('Saturday')
    expect(showOfMeet(meet.id)?.id).toBe(show.id)
    expect(getClass(meet.id, '1')?.name).toBe('Reining')
    expect(getPattern(getClass(meet.id, '1')!.pattern_id).boxes).toHaveLength(7)
    // and the sample show still answers
    expect(getMeet('meet-5')?.classes).toHaveLength(12)
  })

  it('saving again replaces the show instead of adding a second one', () => {
    const show = springShow()
    saveShow(show)
    saveShow({ ...show, name: 'Renamed' })
    expect(userShows().map((s) => s.name)).toEqual(['Renamed'])
  })

  it('loads the draw of a saved show onto the device', () => {
    const show = springShow()
    saveShow(show)
    loadDraw()
    const key = classKey(show.meets[0].id, '2')
    expect(classState(getState(), key).runs.map((r) => [r.draw, r.backNo, r.rider, r.horse])).toEqual([
      [1, '503', 'Cy Cole', 'Super Pete'],
      [2, '504', 'Di Dunn', "O'Malley"],
      [3, '505', 'Eve Ely', 'Rocket'],
    ])
    expect(classState(getState(), key).runs[0].boxes).toHaveLength(7)
  })

  it('a show file round-trips, and anything else is refused', () => {
    const show = springShow()
    expect(readShowFile(JSON.stringify(show))).toEqual(show)
    expect(readShowFile('not json')).toBeNull()
    expect(readShowFile(JSON.stringify({ v: 2, classes: {} }))).toBeNull() // a backup is not a show
  })

  it('changes the size of untouched cards when a pattern changes, and refuses once there are scores', () => {
    const show = springShow()
    saveShow(show)
    loadDraw()
    const key = classKey(show.meets[0].id, '2')
    expect(resizeRuns(key, 9)).toBe(true)
    expect(classState(getState(), key).runs.every((r) => r.boxes.length === 9)).toBe(true)
    const first = classState(getState(), key).runs[0]
    saveRun(key, { ...first, boxes: first.boxes.map(() => 1) })
    expect(resizeRuns(key, 7)).toBe(false)
    expect(classState(getState(), key).runs[0].boxes).toHaveLength(9)
  })
})

describe('placings for the show workbook', () => {
  it('gives one line per draw place: the placing, DQ, or nothing', () => {
    loadDraw()
    const key = classKey('meet-5', '4') // Level I, six riders, judge's order
    const cls = getClass('meet-5', '4')!
    const runs = classState(getState(), key).runs
    saveRun(key, { ...runs[5], mark: 'DQ' })
    setPlacings(key, [runs[2].id, runs[0].id, runs[4].id, runs[1].id])
    expect(sheetPlacings(classState(getState(), key), cls)).toEqual(['2', '4', '1', '', '3', 'DQ', '', '', '', '', '', ''])
  })

  it('takes a scored class from its scores, with a disqualified rider as DQ', () => {
    loadDraw()
    const key = classKey('meet-5', '1') // Reining, five riders
    const cls = getClass('meet-5', '1')!
    const give = (i: number, box: number, mark: 'none' | 'DQ' = 'none') => {
      const run = classState(getState(), key).runs[i]
      saveRun(key, { ...run, boxes: run.boxes.map(() => box), mark, scored: true })
    }
    give(0, 0) // 70
    give(1, 2) // 78
    give(2, 1) // 74
    give(3, -1) // 66
    give(4, 3, 'DQ')
    expect(sheetPlacings(classState(getState(), key), cls).slice(0, 6)).toEqual(['3', '1', '2', '4', 'DQ', ''])
  })
})
