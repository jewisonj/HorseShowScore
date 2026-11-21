import type { ShowFile } from '../data/fixture'
import type { CloudBackend, CloudUser } from './backend'

/** A stand-in server for tests. Nothing here touches the network. */
export interface FakeBackend extends CloudBackend {
  /** What is "on the server". */
  shows: ShowFile[]
  /** Accounts that exist, by email. */
  accounts: Record<string, { password: string; admin: boolean }>
  signedIn: CloudUser | null
  /** Set true to act like a server that cannot be reached. */
  down: boolean
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
    async readPatternBook() {
      fake.readerCalls++
      if (fake.down) throw new Error('Failed to fetch')
      if (!(await fake.isShowAdmin())) throw new Error('This account is not on the list of people who can set up shows.')
      return fake.reader
    },
  }
  return fake
}
