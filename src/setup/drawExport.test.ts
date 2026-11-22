import { describe, expect, it } from 'vitest'
import type { Meet, ShowClass, ShowFile } from '../data/fixture'
import { classForSheet, drawCsv, sheetDraw, takeSheetDraw } from './drawExport'

const cls = (id: string, name: string, entries: [number, string, string][], alternates?: string[]): ShowClass => ({
  id,
  class_no: '17',
  name,
  section: '',
  card_family: 'pattern',
  rule_set: 'ihsa-reining',
  pattern_id: 'p',
  notes: '',
  entries: entries.map(([draw, back_no, horse]) => ({ draw, back_no, rider: `Rider ${back_no}`, horse })),
  ...(alternates ? { alternates } : {}),
})

const reining = cls('1', 'Reining', [[2, '502', 'Archie (Roan)'], [1, '501', 'Rocket'], [3, '503', 'Rocket']], ['Spare', "O'Malley"])
const rookie = cls('5', 'Rookie B Horsemanship, Sec. B', [[1, '601', ''], [14, '602', 'Dot'], [1, '603', 'Eli']])
const meet: Meet = { id: 'm1', label: 'Sunday', date: '2027-04-04', coach_meeting: '', start_time: '', judges: [], classes: [reining, rookie] }
const show: ShowFile = { format: 'hss-show', version: 1, id: 's-export1', name: 'Made-up', host: '', association: 'IHSA', meets: [meet], patterns: [] }

describe('the draw in the shape the show sheet takes it', () => {
  it('gives one line for each of the twelve draw places, horses in capitals, and where to paste', () => {
    const d = sheetDraw(meet, reining)
    expect(d.backNos).toEqual(['501', '502', '503', '', '', '', '', '', '', '', '', ''])
    expect(d.horses).toEqual(['ROCKET', 'ARCHIE (ROAN)', 'ROCKET', '', '', '', '', '', '', '', '', ''])
    expect(d.alternates).toEqual(['SPARE', "O'MALLEY", '', '', ''])
    expect(d.cells).toEqual({ backCell: 'B6', horseCell: 'D6', alternateCell: 'D18' })
    expect(d.leftOut).toEqual([])
  })

  it('says which riders do not fit in the twelve places instead of dropping them quietly', () => {
    const d = sheetDraw(meet, rookie)
    expect(d.backNos[0]).toBe('601')
    // 602 has draw place 14 and 603 shares place 1.
    expect(d.leftOut).toEqual(['602', '603'])
    // Class 5 is the middle block of the second band.
    expect(d.cells).toEqual({ backCell: 'H26', horseCell: 'J26', alternateCell: 'J38' })
  })

  it('makes a CSV with a back number and a horse column for each class', () => {
    const lines = drawCsv(show).trim().split('\n')
    expect(lines[0]).toBe('Place,1. Reining: back #,1. Reining: horse,"5. Rookie B Horsemanship, Sec. B: back #","5. Rookie B Horsemanship, Sec. B: horse"')
    expect(lines[1]).toBe('Paste at,B6,D6,H26,J26')
    expect(lines[2]).toBe('1,501,ROCKET,601,')
    expect(lines[3]).toBe('2,502,ARCHIE (ROAN),,')
    expect(lines).toHaveLength(2 + 12 + 5)
    expect(lines[14]).toBe('Alternate 1,,SPARE,,')
    expect(lines[15]).toBe("Alternate 2,,O'MALLEY,,")
  })
})

describe('a class on the sheet and the class of the show it is', () => {
  const cls = (id: string, name: string): ShowClass => ({ id, class_no: '13', name, section: '', card_family: 'placings', rule_set: 'ihsa-horsemanship', pattern_id: 'p', notes: '', entries: [] })
  const day = (classes: ShowClass[]): Meet => ({ id: 'm', label: 'Sunday', date: '2026-11-22', coach_meeting: '', start_time: '', judges: [], classes })

  it('goes by the name when the sheet gives one, whatever the numbers say', () => {
    // A show with one class per division, numbered by IHSA class number.
    const meet = day([cls('17', 'Open Reining'), cls('12B', 'Rookie B Western Horsemanship'), cls('12A', 'Rookie A Western Horsemanship'), cls('11', 'Beginner Horsemanship')])
    expect(classForSheet(meet, { classNo: 11, name: 'BEGINNER HORSEMANSHIP' })!.id).toBe('11')
    // Class 2 of the sheet is not the second class here, and class 11 is not the class numbered 11 unless the name agrees.
    expect(classForSheet(meet, { classNo: 2, name: 'OPEN HORSEMANSHIP' })).toBeUndefined()
    expect(classForSheet(meet, { classNo: 11, name: 'LEVEL II HORSEMANSHIP, SEC. B' })).toBeUndefined()
    // Capitals, spacing and punctuation do not matter.
    const sections = day([cls('4', 'Level I Horsemanship, Sec. A'), cls('7', 'Level I Horsemanship, Sec. B')])
    expect(classForSheet(sections, { classNo: 1, name: 'LEVEL I  HORSEMANSHIP SEC B' })!.id).toBe('7')
  })

  it('goes by the running number when the sheet gives no name', () => {
    const meet = day([cls('1', 'Reining'), cls('2', 'Ranch Riding')])
    expect(classForSheet(meet, { classNo: 2, name: '' })!.name).toBe('Ranch Riding')
    expect(classForSheet(meet, { classNo: 3, name: '' })).toBeUndefined()
  })

  it('puts each rider on the horse of the place the sheet has them in', () => {
    const entries = [
      { draw: 1, back_no: '10', rider: 'Ann', horse: 'Old' },
      { draw: 2, back_no: '20', rider: 'Bo', horse: '' },
      { draw: 3, back_no: '30', rider: 'Cy', horse: '' },
    ]
    const got = takeSheetDraw(entries, { places: ['Ace', 'Bay', 'Ace'], backNos: ['30', '', '40', '30'] }, (b) => (b === '40' ? 'Di' : ''))
    expect(got.entries).toEqual([
      { draw: 1, back_no: '30', rider: 'Cy', horse: 'Ace' },
      { draw: 3, back_no: '40', rider: 'Di', horse: 'Ace' },
      // Bay has nobody yet, so the class is still being drawn: the two not typed yet wait, with no horse.
      { draw: 13, back_no: '10', rider: 'Ann', horse: '' },
      { draw: 14, back_no: '20', rider: 'Bo', horse: '' },
    ])
    expect([got.finished, got.out, got.waiting]).toEqual([false, [], ['10', '20']])

    // Every horse has a rider: the class is finished, and it is who the sheet has. The rest scratched or moved.
    const done = takeSheetDraw(entries, { places: ['Ace', 'Bay'], backNos: ['30', '40'] }, () => 'Di')
    expect(done.entries).toEqual([
      { draw: 1, back_no: '30', rider: 'Cy', horse: 'Ace' },
      { draw: 2, back_no: '40', rider: 'Di', horse: 'Bay' },
    ])
    expect([done.finished, done.out, done.waiting]).toEqual([true, ['10', '20'], []])
    expect(got.added).toEqual(['40'])
  })
})
