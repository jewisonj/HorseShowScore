import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBackendForTests, startCloud } from '../cloud/cloud'
import { makeFakeBackend, type FakeBackend } from '../cloud/fakeBackend'
import { clearCloudCache } from '../data/cloudShows'
import type { ShowFile } from '../data/fixture'
import { clearShows, saveShow } from '../data/shows'
import { clearAll } from '../store'
import { PublicHome, PublicShow } from './PublicScreens'

function published(): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id: 's-pub000001',
    name: 'Made-up Winter Show',
    host: 'Made-up College',
    association: 'IHSA',
    meets: [
      {
        id: 's-pub000001-m1',
        label: 'Saturday',
        date: '2027-01-16',
        coach_meeting: '',
        start_time: '',
        judges: [],
        classes: [
          {
            id: '1',
            class_no: '17',
            name: 'Open Reining',
            section: '',
            card_family: 'pattern',
            rule_set: 'ihsa-reining',
            pattern_id: 'p-pub-1',
            notes: '',
            entries: [
              { draw: 2, back_no: '302', rider: 'Blake Sample', horse: 'Roan' },
              { draw: 1, back_no: '301', rider: 'Avery Example', horse: 'Dun It' },
            ],
          },
          { id: '2', class_no: '14', name: 'Level II Horsemanship', section: '', card_family: 'placings', rule_set: 'ihsa-horsemanship', pattern_id: 'p-pub-1', notes: '', entries: [] },
        ],
      },
    ],
    patterns: [
      { id: 'p-pub-1', name: 'Made-up pattern 4', kind: 'reining', source_page: 3, page_image: 'pages/pg-abc123def4.jpg', boxes: [{ n: 1, abbr: 'Rr S', label: 'LF right, SS right, stop', tags: [] }] },
    ],
  }
}

let server: FakeBackend

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  window.location.hash = ''
  server = makeFakeBackend()
  setBackendForTests(server)
})

afterEach(() => cleanup())

describe('the public side', () => {
  it('lists only published shows: no samples, and no copy being worked on here', async () => {
    server.shows = [published()]
    const draft = published()
    draft.id = 's-draft00001'
    draft.name = 'Not published yet'
    saveShow(draft)
    render(<PublicHome />)
    expect(await screen.findByRole('button', { name: /Made-up Winter Show/ })).toBeTruthy()
    expect(screen.queryByText(/Sample that comes with the app/)).toBeNull()
    expect(screen.queryByText(/IHSA Western Show/)).toBeNull()
    expect(screen.queryByText('Not published yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Made-up Winter Show/ }))
    expect(window.location.hash).toBe('#/public/s-pub000001')
  })

  it('shows each class with its draw in order and its pattern, and nothing to score with', async () => {
    server.shows = [published()]
    await startCloud()
    render(<PublicShow showId="s-pub000001" />)
    const reining = screen.getByText('1. Open Reining').closest('details')!
    expect(within(reining).getByText(/2 riders, Made-up pattern 4/)).toBeTruthy()
    const riders = within(reining).getAllByRole('listitem').slice(0, 2).map((li) => li.textContent)
    expect(riders[0]).toMatch(/1.*301.*Avery Example.*Dun It/)
    expect(riders[1]).toMatch(/2.*302.*Blake Sample.*Roan/)
    expect(within(reining).getByText('LF right, SS right, stop')).toBeTruthy()
    expect(within(reining).getByRole('img', { name: 'Pattern book page for Made-up pattern 4' })).toBeTruthy()
    // A class whose draw is not in yet says so.
    expect(within(screen.getByText('2. Level II Horsemanship').closest('details')!).getByText(/Draw not posted yet/)).toBeTruthy()
    // Read only: only the way back, and the note that it is unofficial.
    expect(screen.queryByRole('button', { name: /Score|Place|rail|Publish|setup|Export|Download/i })).toBeNull()
    expect(screen.getByText(/Unofficial test/)).toBeTruthy()
  })

  it('shows what is published, not changes still being worked on in setup on this device', async () => {
    server.shows = [published()]
    await startCloud()
    const changed = published()
    changed.meets[0].classes[0].entries[0].rider = 'Changed Here Only'
    saveShow(changed)
    render(<PublicShow showId="s-pub000001" />)
    expect(screen.getByText('Blake Sample')).toBeTruthy()
    expect(screen.queryByText('Changed Here Only')).toBeNull()
  })

  it('says so when a show is not published or the link is wrong', async () => {
    await startCloud()
    render(<PublicShow showId="evt-bhc-2026-11-21" />)
    expect(screen.getByText(/This show is not published/)).toBeTruthy()
  })
})
