import type { Meet, ShowClass, ShowFile } from '../data/fixture'
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
