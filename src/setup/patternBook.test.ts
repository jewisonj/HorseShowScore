import { describe, expect, it } from 'vitest'
import type { ShowClass, ShowFile } from '../data/fixture'
import { addReadPatterns, divisionsNamed, patternsFromReader } from './patternBook'

const cls = (id: string, class_no: string, name: string, pattern_id = ''): ShowClass => ({
  id,
  class_no,
  name,
  section: '',
  card_family: 'pattern',
  rule_set: 'ihsa-horsemanship',
  pattern_id,
  notes: '',
  entries: [],
})

function twoDayShow(): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id: 's-test00001',
    name: 'Made-up show',
    host: '',
    association: 'IHSA',
    meets: [
      { id: 'm-sat', label: 'Saturday', date: '2027-03-06', coach_meeting: '', start_time: '', judges: [], classes: [cls('1', '17', 'Open Reining'), cls('2', '14', 'Level II Horsemanship, Sec. A'), cls('3', '14', 'Level II Horsemanship, Sec. B'), cls('4', '12A', 'Rookie A Horsemanship')] },
      { id: 'm-sun', label: 'Day 2', date: '2027-03-07', coach_meeting: '', start_time: '', judges: [], classes: [cls('1', '17', 'Open Reining'), cls('2', '14', 'Level II Horsemanship')] },
    ],
    patterns: [],
  }
}

const found = (name: string, classes: string[], kind = 'horsemanship') => ({
  name,
  kind,
  page: 1,
  classes,
  boxes: [
    { code: 'J', words: 'Jog to center cone' },
    { code: 'S&B', words: 'Stop, back one length' },
  ],
  unsure: '',
})

describe('what the pattern book reader sends back', () => {
  it('becomes patterns with numbered boxes, and tags from the words', () => {
    const read = patternsFromReader({ patterns: [found('Level II M', ['Level II Horsemanship'])], notes: ' One  page was faint. ' })
    expect(read.notes).toBe('One page was faint.')
    const p = read.patterns[0].pattern
    expect(p.name).toBe('Level II M')
    expect(p.kind).toBe('horsemanship')
    expect(p.boxes.map((b) => [b.n, b.abbr, b.label])).toEqual([
      [1, 'J', 'Jog to center cone'],
      [2, 'S&B', 'Stop, back one length'],
    ])
    expect(p.boxes[1].tags).toContain('stop')
    expect(p.id).toMatch(/^p-/)
  })

  it('is not trusted: junk is dropped and long text is cut', () => {
    const read = patternsFromReader({
      patterns: [null, 'text', { name: 'No boxes', boxes: [] }, { name: 'x'.repeat(200), kind: 'made up', page: 'two', classes: 'Open', boxes: [{ code: 'c'.repeat(50), words: 5 }] }],
    })
    expect(read.patterns).toHaveLength(1)
    const p = read.patterns[0].pattern
    expect(p.name).toHaveLength(80)
    expect(p.kind).toBe('other')
    expect(p.source_page).toBe(0)
    expect(p.boxes[0].abbr).toHaveLength(12)
    expect(read.patterns[0].classes).toEqual([])
    expect(patternsFromReader(null).patterns).toEqual([])
    expect(patternsFromReader('<html>').patterns).toEqual([])
  })

  it('knows which divisions a line names', () => {
    expect(divisionsNamed('Open Reining')).toEqual(['17'])
    expect(divisionsNamed('Level II/Open Horsemanship')).toEqual(['14', '16'])
    expect(divisionsNamed('Level I Horsemanship')).toEqual(['13'])
    expect(divisionsNamed('Rookie Horsemanship')).toEqual(['12A', '12B'])
    expect(divisionsNamed('Rookie B')).toEqual(['12B'])
    expect(divisionsNamed('Class 5')).toEqual([])
  })
})

describe('adding read patterns to a show', () => {
  it('gives each class its pattern where the book leaves no doubt', () => {
    const read = patternsFromReader({
      patterns: [found('Reining 3', ['Open Reining'], 'reining'), found('Level II M', ['Saturday Level II Horsemanship']), found('Level II R', ['Sunday: Level II Horsemanship'])],
    }).patterns
    const done = addReadPatterns(twoDayShow(), read)
    expect(done.added).toBe(3)
    const name = (id: string) => done.show.patterns.find((p) => p.id === id)?.name ?? ''
    const sat = done.show.meets[0].classes.map((c) => name(c.pattern_id))
    const sun = done.show.meets[1].classes.map((c) => name(c.pattern_id))
    // Both sections on Saturday ride M. Sunday is found from its date, though its label is "Day 2".
    expect(sat).toEqual(['Reining 3', 'Level II M', 'Level II M', ''])
    expect(sun).toEqual(['Reining 3', 'Level II R'])
    expect(done.assigned).toBe(5)
  })

  it('leaves a class alone when two patterns claim it, or it already has one', () => {
    const show = twoDayShow()
    show.patterns = [{ id: 'p-kept', name: 'Chosen by hand', kind: 'reining', source_page: 0, boxes: [{ n: 1, abbr: 'W', label: 'Walk', tags: [] }] }]
    show.meets[0].classes[0].pattern_id = 'p-kept'
    const read = patternsFromReader({
      patterns: [found('Reining 3', ['Open Reining'], 'reining'), found('Level II M', ['Level II Horsemanship']), found('Level II R', ['Level II Horsemanship'])],
    }).patterns
    const done = addReadPatterns(show, read)
    expect(done.show.meets[0].classes[0].pattern_id).toBe('p-kept')
    expect(done.show.meets[0].classes[1].pattern_id).toBe('')
    expect(done.show.meets[1].classes[1].pattern_id).toBe('')
    // Sunday's reining had no pattern and only one claims it.
    expect(done.assigned).toBe(1)
  })

  it('matches a class by its number when the book gives numbers', () => {
    const read = patternsFromReader({ patterns: [found('Rookie K', ['Class 4'])] }).patterns
    const done = addReadPatterns(twoDayShow(), read)
    expect(done.show.meets[0].classes[3].pattern_id).toBe(read[0].pattern.id)
  })

  it('a pattern read again replaces the one of the same name and keeps its classes', () => {
    const show = twoDayShow()
    show.patterns = [{ id: 'p-old', name: 'Level II M', kind: 'horsemanship', source_page: 0, boxes: [{ n: 1, abbr: 'W', label: 'Walk', tags: [] }] }]
    show.meets[0].classes[1].pattern_id = 'p-old'
    const done = addReadPatterns(show, patternsFromReader({ patterns: [found('level ii m', [])] }).patterns)
    expect(done.replaced).toBe(1)
    expect(done.show.patterns).toHaveLength(1)
    expect(done.show.patterns[0].id).toBe('p-old')
    expect(done.show.patterns[0].boxes).toHaveLength(2)
    expect(done.show.meets[0].classes[1].pattern_id).toBe('p-old')
  })
})
