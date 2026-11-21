import type { ShowFile } from '../data/fixture'

export interface CloudUser {
  id: string
  email: string
}

/**
 * Everything the app asks of the server. The real one talks to Supabase
 * (supabaseBackend.ts). Tests hand in a fake, so no test touches the network.
 * Methods that read or change shows throw when the server refuses or cannot be reached.
 */
export interface CloudBackend {
  user(): Promise<CloudUser | null>
  onUserChange(fn: (user: CloudUser | null) => void): () => void
  /** Returns what went wrong, in plain words, or null when signed in. */
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
  /** Whether the signed-in person is on the list of people who may set up shows. */
  isShowAdmin(): Promise<boolean>
  /** The published shows, as stored. Not yet checked to be show files. */
  listShows(): Promise<unknown[]>
  publishShow(show: ShowFile): Promise<void>
  removeShow(id: string): Promise<void>
  /** Send a pattern book PDF, as base64, to the reader. Returns what it found, not yet checked. */
  readPatternBook(pdfBase64: string): Promise<unknown>
}
