import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classKey } from '../data/fixture'
import { clearShows, userShows } from '../data/shows'
import { sampleShowWorkbook } from '../setup/testWorkbook'
import { classState, clearAll, getState } from '../store'
import { Home } from './Home'
import { SetupScreen } from './SetupScreen'
import { ShowScreen } from './ShowScreen'

beforeEach(() => {
  clearAll()
  clearShows()
  window.location.hash = ''
})

afterEach(() => cleanup())

/** Pick a pattern for the class row whose name field holds `className`, by the option's visible text. */
function pickPattern(className: string, optionText: RegExp) {
  // The division menu can show the same words as the class name, so look for the text field.
  const row = screen.getAllByDisplayValue(className).find((el) => el.tagName === 'INPUT')!.closest('li')!
  const select = within(row).getByLabelText('Pattern') as HTMLSelectElement
  const option = Array.from(select.options).find((o) => optionText.test(o.text))
  if (!option) throw new Error(`No pattern option matching ${optionText} for ${className}`)
  fireEvent.change(select, { target: { value: option.value } })
}

describe('the first screen', () => {
  it('lists the shows on this device and offers to create or open one', () => {
    render(<Home />)
    expect(screen.getByRole('button', { name: /IHSA Western Meets/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create a show' }))
    expect(window.location.hash).toBe('#/new')
    expect(screen.getByRole('button', { name: 'Open a show file' })).toBeTruthy()
  })

  it('the sample show cannot be changed or removed', () => {
    render(<ShowScreen showId="evt-bhc-2026-11" />)
    expect(screen.getByRole('button', { name: 'Download the show file' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change the setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove this show/ })).toBeNull()
  })
})

describe('creating a show', () => {
  it('says what is missing instead of saving an empty show', () => {
    render(<SetupScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Save the show' }))
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Give the show a name.')).toBeTruthy()
    expect(within(alert).getByText('Add at least one class.')).toBeTruthy()
    expect(userShows()).toHaveLength(0)
  })

  it('reads the workbook, takes a pattern per class, saves, and loads the draw', async () => {
    render(<SetupScreen />)
    const file = new File([new Uint8Array(sampleShowWorkbook()).buffer as ArrayBuffer], 'show.xlsx')
    fireEvent.change(screen.getByLabelText('Show workbook'), { target: { files: [file] } })
    expect(await screen.findByText(/Read 5 classes and 6 rides over 2 days/)).toBeTruthy()
    expect(screen.getByDisplayValue('March 6, 2027 Spring Western Show')).toBeTruthy() // the show name came from the workbook
    expect(screen.getByText('"Level II Horsemanship" has no riders yet.')).toBeTruthy()

    // Not ready yet: every class needs a pattern.
    fireEvent.click(screen.getByRole('button', { name: 'Save the show' }))
    expect(within(screen.getByRole('alert')).getByText('Saturday: choose a pattern for Reining.')).toBeTruthy()

    pickPattern('Reining', /^NRHA Reining Pattern 8/)
    pickPattern('Level I Horsemanship, Sec. A', /^Level I T/)
    pickPattern('Level II Horsemanship', /^Level II\/Open M/)
    pickPattern('Ranch Riding', /^AQHA Ranch Riding Pattern 10/)
    pickPattern('Rookie B Horsemanship', /^Rookie K/)
    fireEvent.click(screen.getByRole('button', { name: 'Save the show' }))

    const [show] = userShows()
    expect(show.name).toBe('March 6, 2027 Spring Western Show')
    expect(show.meets.map((m) => [m.label, m.date, m.classes.length])).toEqual([
      ['Saturday', '2027-03-06', 3],
      ['Sunday', '2027-03-07', 2],
    ])
    expect(show.patterns).toHaveLength(5)
    expect(window.location.hash).toBe(`#/s/${show.id}`)
    // The draw is on the device, ready to score.
    const riders = classState(getState(), classKey(show.meets[0].id, '1')).runs
    expect(riders.map((r) => [r.backNo, r.rider, r.horse])).toEqual([
      ['501', 'Ada Able', 'Rocket'],
      ['502', 'Ben Baker', 'Archie (Roan)'],
    ])
    expect(riders[0].boxes).toHaveLength(7)
  })

  it('builds a show by hand with a new pattern typed in', () => {
    render(<SetupScreen />)
    fireEvent.change(screen.getByLabelText('Show name'), { target: { value: 'Barn schooling show' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-04-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a class' }))
    pickPattern('Open Reining', /^New pattern…/)

    // The editor opens on the new pattern.
    fireEvent.change(screen.getByLabelText('Pattern name'), { target: { value: 'Barn pattern 1' } })
    fireEvent.change(screen.getByLabelText('Maneuvers, one per line'), {
      target: { value: '1. 4 LS | 4 spins left\n2. 4 RS | 4 spins right\n3. SB | Stop, back' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace the maneuvers with these lines' }))
    expect((screen.getByLabelText('Maneuver 3 code') as HTMLInputElement).value).toBe('SB')
    fireEvent.click(screen.getByRole('button', { name: 'Move maneuver 3 up' }))
    expect((screen.getByLabelText('Maneuver 2 words') as HTMLInputElement).value).toBe('Stop, back')
    fireEvent.click(screen.getByRole('button', { name: 'Done with this pattern' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save the show' }))
    const [show] = userShows()
    expect(show.name).toBe('Barn schooling show')
    expect(show.meets[0].classes[0]).toMatchObject({ id: '1', class_no: '17', rule_set: 'ihsa-reining', card_family: 'pattern' })
    expect(show.patterns[0].boxes).toEqual([
      { n: 1, abbr: '4 LS', label: '4 spins left', tags: ['spin'] },
      { n: 2, abbr: 'SB', label: 'Stop, back', tags: ['stop', 'backup'] },
      { n: 3, abbr: '4 RS', label: '4 spins right', tags: ['spin'] },
    ])
  })
})
