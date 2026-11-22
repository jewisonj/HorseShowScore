import type { Entry, Meet, ShowClass } from '../data/fixture'
import { dateIn, inferDivision, nextDay, sectionOf, titleCase } from './build'
import type { CellValue, Workbook } from './xlsx'

/**
 * Reads the IHSA show workbook that show secretaries keep in Google Sheets.
 *
 * What it relies on, all checked against a real workbook:
 * - "Class List": the show title in B2, then one class per row from row 3:
 *   number in A, name in B, day in C, judge in D.
 * - One tab per class, named exactly as the class. Rows 6 to 17 are the twelve
 *   draw places: draw in D, back number in E, rider in F, horse in H.
 * - Placings are typed into J6 to J17 of each class tab. Nothing else on the
 *   tab is typed in for results.
 * - "Horse Points": the show's horses, one name per row from C3.
 * - "Exhibitors": back number in B, rider in C, school in D, from row 5.
 * - The draw tab, whose name ends in "Draw": three classes side by side, twenty
 *   rows to a band. A class's number is in A, G or M of the band's heading row
 *   (row 4, 24, 44 ...). Its twelve draw places follow two rows down: back
 *   number in B, H or N and horse in D, J or P. Five alternates come after.
 */
export const FIRST_ROW = 6
export const LAST_ROW = 17
/** Where a class tab takes its placings. */
export const PLACINGS_FIRST_CELL = `J${FIRST_ROW}`

const DAY_ORDER = ['friday', 'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday']

export interface WorkbookShow {
  /** The show's title from the Class List tab */
  title: string
  /** One meet per day, classes in running order. Classes have no pattern chosen yet. */
  meets: Meet[]
  rides: number
  /** Things a person should look at, in plain words */
  notes: string[]
}

function text(v: CellValue): string {
  if (v === null || typeof v === 'boolean') return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

function findTab(wb: Workbook, name: string): string | undefined {
  const want = name.trim().toLowerCase()
  return wb.sheetNames.find((s) => s.trim().toLowerCase() === want)
}

/**
 * The horses a show has to draw from: the names typed into the "Horse Points"
 * tab, C3 downward. Empty when the workbook has no such tab.
 */
export function readHorseList(wb: Workbook): string[] {
  const tab = findTab(wb, 'Horse Points')
  if (!tab) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (let row = 3; row <= 200; row++) {
    const name = titleCase(text(wb.cell(tab, `C${row}`)))
    if (!name || name.startsWith('#') || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names
}

/** The horses the draw tab sets for one class: one per draw place, top to bottom, then the alternates. */
export interface WorkbookClassHorses {
  /** The show's running class number, from the block's heading. */
  classNo: number
  /** The horse in each draw place, first place first. Empty where a place has no horse. Places after the last horse are left off. */
  places: string[]
  alternates: string[]
}

const DRAW_BLOCKS = [
  { number: 'A', back: 'B', horse: 'D' },
  { number: 'G', back: 'H', horse: 'J' },
  { number: 'M', back: 'N', horse: 'P' },
]
/** A block is twenty rows: a heading, twelve draw places, five alternates and a gap. */
const DRAW_BLOCK_ROWS = 20
const DRAW_PLACES = 12
const DRAW_ALTERNATES = 5

/**
 * Where a class sits on the draw tab, from its running class number: three
 * classes side by side, then the next three below. Class 1 has its back numbers
 * from B6, its horses from D6 and its alternates from D18.
 */
export function drawTabCells(classNo: number): { backCell: string; horseCell: string; alternateCell: string } | null {
  if (!Number.isInteger(classNo) || classNo < 1) return null
  const block = DRAW_BLOCKS[(classNo - 1) % 3]
  const top = 6 + DRAW_BLOCK_ROWS * Math.floor((classNo - 1) / 3)
  return { backCell: `${block.back}${top}`, horseCell: `${block.horse}${top}`, alternateCell: `${block.horse}${top + DRAW_PLACES}` }
}

/**
 * The horses set for each class on the draw tab ("Draw", "Sunday Draw"): the
 * horse committee types a horse beside each draw place before the riders draw.
 * A class with no horses typed in yet is left out.
 */
export function readDrawTab(wb: Workbook): WorkbookClassHorses[] {
  const out: WorkbookClassHorses[] = []
  const seen = new Set<number>()
  for (const tab of wb.sheetNames.filter((s) => /draw\s*$/i.test(s))) {
    for (let band = 0; band < 12; band++) {
      const heading = 4 + DRAW_BLOCK_ROWS * band
      for (const block of DRAW_BLOCKS) {
        const n = wb.cell(tab, `${block.number}${heading}`)
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || seen.has(n)) continue
        const name = (row: number) => {
          const horse = titleCase(text(wb.cell(tab, `${block.horse}${row}`)))
          return horse.startsWith('#') ? '' : horse
        }
        const places: string[] = []
        for (let i = 0; i < DRAW_PLACES; i++) places.push(name(heading + 2 + i))
        while (places.length > 0 && places[places.length - 1] === '') places.pop()
        const alternates: string[] = []
        for (let i = 0; i < DRAW_ALTERNATES; i++) {
          const horse = name(heading + 2 + DRAW_PLACES + i)
          if (horse) alternates.push(horse)
        }
        if (places.every((p) => p === '') && alternates.length === 0) continue
        seen.add(n)
        out.push({ classNo: n, places, alternates })
      }
    }
  }
  return out.sort((a, b) => a.classNo - b.classNo)
}

/** A rider as the workbook's Exhibitors tab lists them: back number, name and school. */
export interface WorkbookRider {
  backNo: string
  rider: string
  team: string
}

/**
 * Everyone on the "Exhibitors" tab: back number in B, rider in C and school in
 * D, from row 5. A row with no back number is left out. Each back number once.
 */
export function readRoster(wb: Workbook): WorkbookRider[] {
  const tab = findTab(wb, 'Exhibitors')
  if (!tab) return []
  const riders: WorkbookRider[] = []
  const seen = new Set<string>()
  for (let row = 5; row <= 400; row++) {
    const back = wb.cell(tab, `B${row}`)
    const backNo = typeof back === 'number' ? String(back) : text(back)
    if (!/^[A-Za-z0-9]{1,8}$/.test(backNo) || backNo === '0' || seen.has(backNo)) continue
    const rider = text(wb.cell(tab, `C${row}`))
    if (!rider || rider.startsWith('#')) continue
    seen.add(backNo)
    riders.push({ backNo, rider, team: text(wb.cell(tab, `D${row}`)) })
  }
  return riders
}

function entriesOf(wb: Workbook, tab: string): Entry[] {
  const entries: Entry[] = []
  for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
    const back = wb.cell(tab, `E${row}`)
    const backNo = typeof back === 'number' ? String(back) : text(back)
    if (!backNo || backNo === '0' || backNo.startsWith('#')) continue
    const draw = wb.cell(tab, `D${row}`)
    const rider = text(wb.cell(tab, `F${row}`))
    const horse = text(wb.cell(tab, `H${row}`))
    entries.push({
      draw: typeof draw === 'number' ? draw : row - FIRST_ROW + 1,
      back_no: backNo,
      rider: rider.startsWith('#') ? '' : rider,
      horse: horse.startsWith('#') ? '' : titleCase(horse),
    })
  }
  return entries
}

/** Build the days, classes and draw of a show from its workbook. `idPrefix` keeps meet ids unique. */
export function readShowWorkbook(wb: Workbook, idPrefix: string): WorkbookShow {
  const list = findTab(wb, 'Class List')
  if (!list) throw new Error('This workbook has no "Class List" tab, so it is not a show workbook this app knows.')

  const title = text(wb.cell(list, 'B2'))
  const notes: string[] = []
  const byDay = new Map<string, { classes: ShowClass[] }>()
  let rides = 0

  for (let row = 3; row <= 60; row++) {
    const name = text(wb.cell(list, `B${row}`))
    const day = text(wb.cell(list, `C${row}`))
    if (!name || !day) continue // totals such as "High Point Rider Standings" have no day
    const number = wb.cell(list, `A${row}`)
    const tab = findTab(wb, name)
    const entries = tab ? entriesOf(wb, tab) : []
    if (!tab) notes.push(`"${name}" is in the class list but has no tab of its own, so it has no riders.`)
    else if (entries.length === 0) notes.push(`"${name}" has no riders yet.`)
    rides += entries.length

    const division = inferDivision(name)
    // Column D holds the judge. It is not read: judges' names stay out of shows.
    const slot = byDay.get(day) ?? { classes: [] }
    slot.classes.push({
      id: typeof number === 'number' ? String(number) : String(slot.classes.length + 1),
      class_no: division.class_no,
      name,
      section: sectionOf(name),
      card_family: division.card_family,
      rule_set: division.rule_set,
      pattern_id: '',
      notes: '',
      entries,
    })
    byDay.set(day, slot)
  }

  if (byDay.size === 0) throw new Error('The "Class List" tab has no classes with a day set.')

  const days = [...byDay.keys()].sort((a, b) => DAY_ORDER.indexOf(a.toLowerCase()) - DAY_ORDER.indexOf(b.toLowerCase()))
  let date = dateIn(title)
  const meets: Meet[] = days.map((day, i) => {
    const slot = byDay.get(day)!
    const meet: Meet = {
      id: `${idPrefix}-m${i + 1}`,
      label: day,
      date,
      coach_meeting: '',
      start_time: '',
      judges: [],
      classes: slot.classes,
    }
    if (date) date = nextDay(date)
    return meet
  })
  if (!dateIn(title)) notes.push('No date was found in the show title. Set the date for each day.')

  return { title, meets, rides, notes }
}
