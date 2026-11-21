import type { ShowFile } from '../data/fixture'
import type { CloudBackend, CloudUser, PublishedClass, SeatPin, SentScores } from './backend'

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
  /** The seats and PINs a show admin set, by show id. */
  seats: Record<string, SeatPin[]>
  /** True for the show's office PIN, or a signed-in show admin giving no PIN. */
  office(showId: string, pin: string): Promise<boolean>
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
    seats: {},
    async office(showId, pin) {
      if (pin === '') return fake.isShowAdmin()
      return (fake.seats[showId] ?? []).some((x) => x.pin === pin && x.role === 'office')
    },
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
    async checkPin(showId, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      const seat = (fake.seats[showId] ?? []).find((x) => x.pin === pin)
      return seat ? { role: seat.role, seatNo: seat.seatNo } : null
    },
    async listSeats(showId) {
      if (fake.down) throw new Error('Failed to fetch')
      return (await fake.isShowAdmin()) ? (fake.seats[showId] ?? []) : []
    },
    async replaceSeats(showId, seats) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy')
      if (new Set(seats.map((x) => x.pin)).size !== seats.length) throw new Error('duplicate key value violates unique constraint "show_seats_pin_once_per_show"')
      fake.seats[showId] = seats.map((x) => ({ ...x }))
    },
    async sendClassScores(send) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!fake.shows.some((s) => s.id === send.showId)) return 'not_published'
      const seat = (fake.seats[send.showId] ?? []).find((x) => x.pin === send.pin && x.role === 'judge')
      if (!seat && !(send.pin === '' && (await fake.isShowAdmin()))) return 'wrong_pin'
      fake.sent.push({
        showId: send.showId,
        classKey: send.classKey,
        device: send.device,
        judge: send.judge,
        seatNo: seat ? seat.seatNo : null,
        finished: send.finished,
        rows: JSON.parse(JSON.stringify(send.rows)),
        sentAt: new Date(Date.now() + fake.sent.length).toISOString(),
      })
      return 'ok'
    },
    async listClassScores(showId, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.office(showId, pin))) return []
      return fake.sent.filter((s) => s.showId === showId).reverse()
    },
    async publishPlacings(showId, classKey, placings, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.office(showId, pin))) return 'wrong_pin'
      if (JSON.stringify(placings).includes('"score"')) throw new Error('violates check constraint "class_results_no_scores"')
      fake.placings[showId] = [...(fake.placings[showId] ?? []).filter((c) => c.classKey !== classKey), { classKey, placings, publishedAt: new Date().toISOString() }]
      return 'ok'
    },
    async removePlacings(showId, classKey, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.office(showId, pin))) return 'wrong_pin'
      fake.placings[showId] = (fake.placings[showId] ?? []).filter((c) => c.classKey !== classKey)
      return 'ok'
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
