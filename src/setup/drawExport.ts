import type { Entry, Meet, ShowClass, ShowFile } from '../data/fixture'
import { drawTabCells } from './workbook'

/**
 * The draw, in the shape the show workbook's draw tab takes it: one line per
 * draw place, top to bottom, so a column can be pasted straight in. Horses are
 * in capitals, as the sheet's own horse list is.
 */
export const SHEET_PLACES = 12
export const SHEET_ALTERNATES = 5

/** The show's running class number: the class id when it is a number, else its place in the day. */
export function runningNumber(meet: Meet, cls: ShowClass): number {
  const n = Number(cls.id)
  return Number.isInteger(n) && n >= 1 ? n : meet.classes.indexOf(cls) + 1
}

export interface SheetDraw {
  /** Back number for each of the twelve draw places. Empty where a place has no rider. */
  backNos: string[]
  /** Horse for each of the twelve draw places, in capitals. */
  horses: string[]
  /** Up to five alternates, in capitals, padded with empty lines. */
  alternates: string[]
  /** Where each column starts on the draw tab, or null when the class has no place there. */
  cells: { backCell: string; horseCell: string; alternateCell: string } | null
  /** Riders who do not fit in the twelve places: a draw number past twelve, or one used twice. */
  leftOut: string[]
}

export function sheetDraw(meet: Meet, cls: ShowClass): SheetDraw {
  const backNos = Array.from({ length: SHEET_PLACES }, () => '')
  const horses = Array.from({ length: SHEET_PLACES }, () => '')
  const leftOut: string[] = []
  for (const e of cls.entries) {
    const i = e.draw - 1
    if (!Number.isInteger(i) || i < 0 || i >= SHEET_PLACES || backNos[i] !== '') {
      leftOut.push(e.back_no)
      continue
    }
    backNos[i] = e.back_no
    horses[i] = e.horse.trim().toUpperCase()
  }
  const alternates = Array.from({ length: SHEET_ALTERNATES }, (_, i) => (cls.alternates?.[i] ?? '').trim().toUpperCase())
  return { backNos, horses, alternates, cells: drawTabCells(runningNumber(meet, cls)), leftOut }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The whole draw as a CSV to open beside the sheet: a row per draw place, then
 * the alternates, and for each class a back number column and a horse column.
 * Copy a class's column and paste it into that class's column on the draw tab.
 */
export function drawCsv(show: ShowFile): string {
  const classes = show.meets.flatMap((meet) => meet.classes.map((cls) => ({ meet, cls, draw: sheetDraw(meet, cls) })))
  const label = (meet: Meet, cls: ShowClass) => `${show.meets.length > 1 ? `${meet.label} ` : ''}${runningNumber(meet, cls)}. ${cls.name}`
  const rows: string[][] = []
  rows.push(['Place', ...classes.flatMap(({ meet, cls }) => [`${label(meet, cls)}: back #`, `${label(meet, cls)}: horse`])])
  rows.push(['Paste at', ...classes.flatMap(({ draw }) => [draw.cells?.backCell ?? '', draw.cells?.horseCell ?? ''])])
  for (let i = 0; i < SHEET_PLACES; i++) rows.push([String(i + 1), ...classes.flatMap(({ draw }) => [draw.backNos[i], draw.horses[i]])])
  for (let i = 0; i < SHEET_ALTERNATES; i++) rows.push([`Alternate ${i + 1}`, ...classes.flatMap(({ draw }) => ['', draw.alternates[i]])])
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The class of a day that a class on the sheet's draw tab is.
 *
 * A sheet that names its classes is matched by name and nothing else. A show
 * set up another way numbers its classes differently, and the same number is
 * then a different class: on 2026-11-22 a show with one class per division
 * took three of the sheet's twelve classes by number, two of them wrongly. A
 * sheet that gives no names is matched by running number.
 */
export function classForSheet(meet: Meet, sheet: { classNo: number; name: string }): ShowClass | undefined {
  const name = plain(sheet.name)
  if (name) return meet.classes.find((c) => plain(c.name) === name)
  return meet.classes.find((c) => runningNumber(meet, c) === sheet.classNo)
}

/**
 * A class's riders as the sheet's draw tab has them once the riders have drawn
 * at the coaches' meeting: each back number on its draw place, with the horse
 * the sheet has in that place. Nothing is drawn here.
 *
 * A rider the class already had who is not on the sheet stays, after the
 * others and with no horse, so a half-typed sheet drops nobody. A back number
 * the class did not have is added, named by `nameOf`.
 */
export function takeSheetDraw(
  entries: Entry[],
  sheet: { places: string[]; backNos: string[] },
  nameOf: (backNo: string) => string,
): { entries: Entry[]; added: string[]; missing: string[] } {
  const out: Entry[] = []
  const added: string[] = []
  const seen = new Set<string>()
  sheet.backNos.forEach((backNo, i) => {
    if (!backNo || seen.has(backNo)) return
    seen.add(backNo)
    const had = entries.find((e) => e.back_no === backNo)
    if (!had) added.push(backNo)
    out.push({ draw: i + 1, back_no: backNo, rider: had ? had.rider : nameOf(backNo), horse: sheet.places[i] ?? '' })
  })
  const missing = entries.filter((e) => !seen.has(e.back_no))
  const after = Math.max(SHEET_PLACES, sheet.backNos.length)
  missing.forEach((e, k) => out.push({ ...e, draw: after + 1 + k, horse: '' }))
  return { entries: out, added, missing: missing.map((e) => e.back_no) }
}
