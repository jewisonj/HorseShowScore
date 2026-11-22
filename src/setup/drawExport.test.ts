import { describe, expect, it } from 'vitest'
import type { Meet, ShowClass, ShowFile } from '../data/fixture'
import { drawCsv, sheetDraw } from './drawExport'

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
