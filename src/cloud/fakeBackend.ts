import type { ShowFile } from '../data/fixture'
import type { CloudBackend, CloudUser, PublishedClass, SentScores } from './backend'

/** A stand-in server for tests. Nothing here touches the network. */
export interface FakeBackend extends CloudBackend {
  /** What is "on the server". */
  shows: ShowFile[]
  /** Accounts that exist, by email. */
  accounts: Record<string, { password: string; admin: boolean }>
  signedIn: CloudUser | null
  /** Set true to act like a server that cannot be reached. */
  down: boolean
  /** Every send from a judging device, oldest first, with the show it was for. */
  sent: (SentScores & { showId: string })[]
  /** Published placings, by show id. */
  placings: Record<string, PublishedClass[]>
  /** Pictures of pattern book pages "on the server", by path. */
  pages: Record<string, Blob>
  /** The Excel file the server hands back for a sheet link. Null acts like a sheet that is not shared. */
  workbook: Uint8Array | null
  workbookLinks: string[]
  /** What the pattern book reader answers with. */
  reader: unknown
  readerCalls: number
}

export function makeFakeBackend(): FakeBackend {
  const watchers = new Set<(user: CloudUser | null) => void>()
  const fake: FakeBackend = {
    shows: [],
    accounts: {},
    signedIn: null,
    down: false,
    sent: [],
    placings: {},
    pages: {},
    workbook: null,
    workbookLinks: [],
    reader: { patterns: [], notes: '' },
    readerCalls: 0,
    async user() {
      return fake.signedIn
    },
    onUserChange(fn) {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
    async signIn(email, password) {
      if (fake.down) throw new Error('Failed to fetch')
      const account = fake.accounts[email]
      if (!account || account.password !== password) return 'That email and password do not match an account.'
      fake.signedIn = { id: `user-${email}`, email }
      return null
    },
    async signOut() {
      fake.signedIn = null
    },
    async isShowAdmin() {
      if (fake.down) throw new Error('Failed to fetch')
      return fake.signedIn !== null && fake.accounts[fake.signedIn.email]?.admin === true
    },
    async listShows() {
      if (fake.down) throw new Error('Failed to fetch')
      // The database hands fields back in its own order. Reverse them to make sure nothing depends on it.
      return fake.shows.map((s) => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(s)) as object).reverse()))
    },
    async publishShow(show) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy for table "shows"')
      fake.shows = [...fake.shows.filter((s) => s.id !== show.id), JSON.parse(JSON.stringify(show)) as ShowFile]
    },
    async removeShow(id) {
      if (fake.down) throw new Error('Failed to fetch')
      if (await fake.isShowAdmin()) fake.shows = fake.shows.filter((s) => s.id !== id)
    },
    async sendClassScores(send) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!fake.shows.some((s) => s.id === send.showId)) throw new Error('new row violates row-level security policy')
      fake.sent.push({ showId: send.showId, classKey: send.classKey, device: send.device, judge: send.judge, rows: JSON.parse(JSON.stringify(send.rows)), sentAt: new Date(Date.now() + fake.sent.length).toISOString() })
    },
    async listClassScores(showId) {
      if (fake.down) throw new Error('Failed to fetch')
      // Row-level security hands anyone but a show admin nothing.
      if (!(await fake.isShowAdmin())) return []
      return fake.sent.filter((s) => s.showId === showId).reverse()
    },
    async publishPlacings(showId, classKey, placings) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy')
      if (JSON.stringify(placings).includes('"score"')) throw new Error('violates check constraint "class_results_no_scores"')
      fake.placings[showId] = [...(fake.placings[showId] ?? []).filter((c) => c.classKey !== classKey), { classKey, placings, publishedAt: new Date().toISOString() }]
    },
    async removePlacings(showId, classKey) {
      if (fake.down) throw new Error('Failed to fetch')
      if (await fake.isShowAdmin()) fake.placings[showId] = (fake.placings[showId] ?? []).filter((c) => c.classKey !== classKey)
    },
    async listPlacings(showId) {
      if (fake.down) throw new Error('Failed to fetch')
      return fake.placings[showId] ?? []
    },
    async uploadPatternPage(path, image) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy')
      fake.pages[path] = image
    },
    patternPageUrl(path) {
      return `https://fake.example/storage/v1/object/public/pattern-pages/${path}`
    },
    async fetchWorkbook(link) {
      fake.workbookLinks.push(link)
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('This account is not on the list of people who can set up shows.')
      if (!fake.workbook) throw new Error('Google would not hand over that sheet.')
      return fake.workbook.slice().buffer as ArrayBuffer
    },
    async readPatternBook() {
      fake.readerCalls++
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('This account is not on the list of people who can set up shows.')
      return fake.reader
    },
  }
  return fake
}
