import type { ShowFile } from '../data/fixture'
import type { CloudBackend, CloudUser, PublishedClass, ReleasedCards, RerideAsk, RosterRider, SeatPin, SentScores, TeamPin } from './backend'

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
  /** The riders list. */
  riders: RosterRider[]
  /** The teams and their coach PINs. */
  teams: TeamPin[]
  /** Re-rides asked for, by show id, oldest first. */
  asks: Record<string, RerideAsk[]>
  /** The kind of seat a PIN opens in a show, 'admin' for a signed-in show admin giving no PIN, or null. */
  roleOf(showId: string, pin: string): Promise<'judge' | 'office' | 'steward' | 'admin' | null>
  /** Released score cards, by show id. */
  cards: Record<string, ReleasedCards[]>
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
    cards: {},
    asks: {},
    riders: [],
    teams: [],
    async roleOf(showId, pin) {
      if (pin === '') return (await fake.isShowAdmin()) ? 'admin' : null
      return (fake.seats[showId] ?? []).find((x) => x.pin === pin)?.role ?? null
    },
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
    async askReride(showId, pin, classKey, backNo, reason) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!fake.shows.some((s) => s.id === showId)) return 'not_published'
      const role = await fake.roleOf(showId, pin)
      if (role !== 'steward' && role !== 'admin') return 'wrong_pin'
      const asks = fake.asks[showId] ?? []
      if (asks.some((a) => a.classKey === classKey && a.backNo === backNo && a.status === 'asked')) return 'already_asked'
      fake.asks[showId] = [...asks, { id: `ask-${asks.length + 1}`, classKey, backNo, reason: reason.slice(0, 200), status: 'asked', askedAt: new Date(Date.now() + asks.length).toISOString(), decidedAt: null }]
      return 'ok'
    },
    async listRerideAsks(showId, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if ((await fake.roleOf(showId, pin)) === null) return 'wrong_pin'
      return (fake.asks[showId] ?? []).map((a) => ({ ...a }))
    },
    async decideReride(showId, pin, id, approve) {
      if (fake.down) throw new Error('Failed to fetch')
      const role = await fake.roleOf(showId, pin)
      if (role !== 'judge' && role !== 'admin') return 'wrong_pin'
      const ask = (fake.asks[showId] ?? []).find((a) => a.id === id)
      if (!ask) return 'not_found'
      if (ask.status !== 'asked') return 'already_decided'
      fake.asks[showId] = (fake.asks[showId] ?? []).map((a) => (a.id === id ? { ...a, status: approve ? 'approved' : 'denied', decidedAt: new Date().toISOString() } : a))
      return 'ok'
    },
    async listRiders() {
      if (fake.down) throw new Error('Failed to fetch')
      return (await fake.isShowAdmin()) ? fake.riders.map((r) => ({ ...r })) : []
    },
    async putRiders(riders) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy')
      const put = new Set(riders.map((r) => r.backNo))
      fake.riders = [...fake.riders.filter((r) => !put.has(r.backNo)), ...riders.map((r) => ({ ...r }))]
    },
    async listTeams() {
      if (fake.down) throw new Error('Failed to fetch')
      return (await fake.isShowAdmin()) ? fake.teams.map((t) => ({ ...t })) : []
    },
    async putTeam(team, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('new row violates row-level security policy')
      if (pin !== null && fake.teams.some((t) => t.team !== team && t.pin === pin)) throw new Error('duplicate key value violates unique constraint "teams_pin_once"')
      fake.teams = [...fake.teams.filter((t) => t.team !== team), { team, pin }]
    },
    async coachRiders(pin) {
      if (fake.down) throw new Error('Failed to fetch')
      const team = pin === '' ? undefined : fake.teams.find((t) => t.pin === pin)
      if (!team) return null
      return { team: team.team, riders: fake.riders.filter((r) => r.team === team.team).map((r) => ({ ...r })) }
    },
    async coachSetMark(pin, backNo, height, group) {
      if (fake.down) throw new Error('Failed to fetch')
      const team = pin === '' ? undefined : fake.teams.find((t) => t.pin === pin)
      if (!team) return 'wrong_pin'
      if (!fake.riders.some((r) => r.backNo === backNo && r.team === team.team)) return 'not_yours'
      fake.riders = fake.riders.map((r) => (r.backNo === backNo ? { ...r, height, group } : r))
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
    async releaseCards(showId, classKey, cards, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.office(showId, pin))) return 'wrong_pin'
      fake.cards[showId] = [...(fake.cards[showId] ?? []).filter((c) => c.classKey !== classKey), { classKey, cards: JSON.parse(JSON.stringify(cards)), publishedAt: new Date().toISOString() }]
      return 'ok'
    },
    async takeDownCards(showId, classKey, pin) {
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.office(showId, pin))) return 'wrong_pin'
      fake.cards[showId] = (fake.cards[showId] ?? []).filter((c) => c.classKey !== classKey)
      return 'ok'
    },
    async listCards(showId) {
      if (fake.down) throw new Error('Failed to fetch')
      return fake.cards[showId] ?? []
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
