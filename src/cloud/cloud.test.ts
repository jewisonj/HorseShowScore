import { beforeEach, describe, expect, it } from 'vitest'
import { clearCloudCache, cloudCache } from '../data/cloudShows'
import { allShows, classKey, getShow, type ShowFile } from '../data/fixture'
import { clearShows, saveShow, userShows } from '../data/shows'
import { classState, clearAll, getState, saveRun } from '../store'
import { cloudState, pageImageUrl, publishShow, readPatternBook, refreshShows, sameShow, savePatternPage, setBackendForTests, signIn, startCloud, takeOffServer } from './cloud'
import { makeFakeBackend, type FakeBackend } from './fakeBackend'

/** A small made-up show: one day, one class of two riders, one pattern of `boxes` maneuvers. */
function show(id: string, boxes = 3, name = 'Made-up Spring Show'): ShowFile {
  return {
    format: 'hss-show',
    version: 1,
    id,
    name,
    host: 'Made-up College',
    association: 'IHSA',
    meets: [
      {
        id: `${id}-m1`,
        label: 'Saturday',
        date: '2027-03-06',
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
            pattern_id: `${id}-p1`,
            notes: '',
            entries: [
              { draw: 1, back_no: '101', rider: 'Avery Example', horse: 'Dun It' },
              { draw: 2, back_no: '102', rider: 'Blake Sample', horse: 'Roan' },
            ],
          },
        ],
      },
    ],
    patterns: [
      {
        id: `${id}-p1`,
        name: `Pattern for ${id}`,
        kind: 'reining',
        source_page: 0,
        boxes: Array.from({ length: boxes }, (_, i) => ({ n: i + 1, abbr: `M${i + 1}`, label: `Maneuver ${i + 1}`, tags: [] })),
      },
    ],
  }
}

/** Enter one maneuver score for the first rider of the show's class. */
function scoreSomething(s: ShowFile) {
  const key = classKey(s.meets[0].id, '1')
  const run = classState(getState(), key).runs[0]
  saveRun(key, { ...run, boxes: run.boxes.map((b, i) => (i === 0 ? 1 : b)) })
}

let server: FakeBackend

beforeEach(() => {
  clearAll()
  clearShows()
  clearCloudCache()
  server = makeFakeBackend()
  server.accounts['admin@example.com'] = { password: 'right', admin: true }
  server.accounts['judge@example.com'] = { password: 'right', admin: false }
  setBackendForTests(server)
})

describe('published shows', () => {
  it('a phone lists the shows on the server and gets their draw', async () => {
    server.shows = [show('s-spring01')]
    await startCloud()
    expect(allShows().map((s) => s.id)).toContain('s-spring01')
    expect(cloudState().check).toBe('ok')
    const runs = classState(getState(), classKey('s-spring01-m1', '1')).runs
    expect(runs.map((r) => r.backNo)).toEqual(['101', '102'])
    expect(runs[0].boxes).toHaveLength(3)
  })

  it('with no signal the device keeps the list it had', async () => {
    server.shows = [show('s-spring01')]
    await refreshShows()
    server.down = true
    expect(await refreshShows()).toBe(false)
    expect(cloudState().check).toBe('failed')
    expect(getShow('s-spring01')?.name).toBe('Made-up Spring Show')
  })

  it('anything on the server that is not a show file is ignored', async () => {
    server.shows = [show('s-spring01'), { v: 2 } as unknown as ShowFile]
    await refreshShows()
    expect(cloudCache().shows).toHaveLength(1)
  })

  it('a show taken off the server leaves a phone with no scores for it', async () => {
    server.shows = [show('s-spring01')]
    await refreshShows()
    server.shows = []
    await refreshShows()
    expect(getShow('s-spring01')).toBeUndefined()
  })

  it('but stays on a phone that has scores for it', async () => {
    server.shows = [show('s-spring01')]
    await refreshShows()
    scoreSomething(show('s-spring01'))
    server.shows = []
    await refreshShows()
    expect(getShow('s-spring01')).toBeDefined()
    expect(cloudCache().onServer).toEqual([])
  })

  it('a published change to the draw reaches a phone', async () => {
    server.shows = [show('s-spring01')]
    await refreshShows()
    const changed = show('s-spring01')
    changed.meets[0].classes[0].entries[1].horse = 'Bay'
    server.shows = [changed]
    await refreshShows()
    expect(classState(getState(), classKey('s-spring01-m1', '1')).runs[1].horse).toBe('Bay')
  })

  it('a pattern that gains a maneuver resizes rides with nothing entered', async () => {
    server.shows = [show('s-spring01', 3)]
    await refreshShows()
    server.shows = [show('s-spring01', 4)]
    await refreshShows()
    expect(classState(getState(), classKey('s-spring01-m1', '1')).runs.every((r) => r.boxes.length === 4)).toBe(true)
    expect(cloudCache().held).toEqual([])
  })

  it('but a phone that already scored the class keeps the setup it scored with', async () => {
    server.shows = [show('s-spring01', 3)]
    await refreshShows()
    scoreSomething(show('s-spring01'))
    server.shows = [show('s-spring01', 4)]
    await refreshShows()
    expect(getShow('s-spring01')?.patterns[0].boxes).toHaveLength(3)
    expect(cloudCache().held).toEqual(['s-spring01'])
    expect(classState(getState(), classKey('s-spring01-m1', '1')).runs[0].boxes).toEqual([1, null, null])
  })

  it('a copy being worked on here stands in front of the published one', async () => {
    server.shows = [show('s-spring01')]
    await refreshShows()
    saveShow(show('s-spring01', 3, 'Spring Show, being changed'))
    expect(getShow('s-spring01')?.name).toBe('Spring Show, being changed')
    expect(allShows().filter((s) => s.id === 's-spring01')).toHaveLength(1)
  })
})

describe('publishing', () => {
  it('a show admin publishes a show, and the server copy becomes the one in use', async () => {
    await startCloud()
    expect(await signIn('admin@example.com', 'right')).toBeNull()
    expect(cloudState().admin).toBe(true)
    saveShow(show('s-new00001'))
    expect(await publishShow(show('s-new00001'))).toBeNull()
    expect(server.shows.map((s) => s.id)).toEqual(['s-new00001'])
    expect(userShows()).toHaveLength(0)
    expect(getShow('s-new00001')).toBeDefined()
    expect(cloudCache().onServer).toContain('s-new00001')
  })

  it('judges are never sent to the server, even from an older show file that names one', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    const old = show('s-new00001')
    old.meets[0].judges = ['Pat Example']
    saveShow(old)
    expect(await publishShow(old)).toBeNull()
    expect(server.shows[0].meets[0].judges).toEqual([])
    expect(JSON.stringify(server.shows)).not.toContain('Pat Example')
    expect(getShow('s-new00001')?.meets[0].judges).toEqual([])
  })

  it('someone who is not a show admin is told so, and nothing changes', async () => {
    await startCloud()
    await signIn('judge@example.com', 'right')
    expect(cloudState().admin).toBe(false)
    saveShow(show('s-new00001'))
    expect(await publishShow(show('s-new00001'))).toBe('This account is not allowed to publish shows.')
    expect(server.shows).toHaveLength(0)
    expect(userShows()).toHaveLength(1)
  })

  it('a wrong password is refused in plain words', async () => {
    await startCloud()
    expect(await signIn('admin@example.com', 'wrong')).toBe('That email and password do not match an account.')
    expect(cloudState().user).toBeNull()
  })

  it('with no signal, publishing says so and keeps the copy on this device', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    saveShow(show('s-new00001'))
    server.down = true
    expect(await publishShow(show('s-new00001'))).toMatch(/Could not reach the server/)
    expect(userShows()).toHaveLength(1)
  })

  it('taking a show off the server leaves the setup on the device that did it', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    await publishShow(show('s-new00001'))
    expect(await takeOffServer(show('s-new00001'))).toBeNull()
    expect(server.shows).toHaveLength(0)
    expect(userShows().map((s) => s.id)).toEqual(['s-new00001'])
    expect(cloudCache().onServer).toEqual([])
  })

  it('two copies of a show are the same whatever order their fields come in', () => {
    const a = show('s-same0001')
    const b = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(a)) as object).reverse()) as unknown as ShowFile
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
    expect(sameShow(a, b)).toBe(true)
    expect(sameShow(a, show('s-same0001', 4))).toBe(false)
  })
})

describe('pictures of pattern book pages', () => {
  const picture = new Blob(['x'], { type: 'image/jpeg' })

  it('a show admin stores one and gets back where it is', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    const got = await savePatternPage(picture)
    expect(got.ok && /^pages\/pg-[A-Za-z0-9]+\.jpg$/.test(got.path)).toBe(true)
    expect(got.ok && server.pages[got.path]).toBe(picture)
    expect(got.ok && pageImageUrl(got.path)).toMatch(/\/storage\/v1\/object\/public\/pattern-pages\/pages\/pg-/)
  })

  it('anyone else is refused', async () => {
    await startCloud()
    await signIn('judge@example.com', 'right')
    expect(await savePatternPage(picture)).toEqual({ ok: false, error: 'This account is not allowed to add pattern pictures.' })
    expect(server.pages).toEqual({})
  })

  it('only paths the app makes become addresses', () => {
    for (const bad of [undefined, '', 'https://evil.example/a.jpg', '//evil.example/a.jpg', 'pages/../a.jpg', 'pages/a b.jpg', 'pages/abcd.svg', 'other/abcd.jpg']) {
      expect(pageImageUrl(bad)).toBeNull()
    }
  })
})

describe('sending a pattern book', () => {
  const file = (bytes: number[], size = bytes.length) => ({ name: 'book.pdf', size, arrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer })

  it('a file that is not a PDF never leaves the device', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    expect(await readPatternBook(file([1, 2, 3, 4, 5]))).toEqual({ ok: false, error: 'That file is not a PDF.' })
    expect(server.readerCalls).toBe(0)
  })

  it('nor does one over 8 MB', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    const result = await readPatternBook(file([0x25, 0x50, 0x44, 0x46, 0x2d], 9 * 1024 * 1024))
    expect(result.ok).toBe(false)
    expect(server.readerCalls).toBe(0)
  })

  it('a PDF goes to the reader and its answer comes back', async () => {
    await startCloud()
    await signIn('admin@example.com', 'right')
    server.reader = { patterns: [{ name: 'Pattern A' }], notes: '' }
    expect(await readPatternBook(file([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toEqual({ ok: true, found: server.reader })
  })
})
