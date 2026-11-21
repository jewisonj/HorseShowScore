import type { ShowFile } from '../data/fixture'

export interface CloudUser {
  id: string
  email: string
}

/** One rider in a class, as a judging device has it. Sent to the server; read by show admins only. */
export interface SentRow {
  /** 1-based place, or null when not placed */
  place: number | null
  tied: boolean
  back_no: string
  rider: string
  horse: string
  /** Score in half points, when the rider has a saved score */
  score: number | null
  /** 'none', or the mark on the card: OP, ZERO, DQ */
  mark: string
  /** Something was entered for this rider */
  rode: boolean
}

/** What one judging device last sent for one class. */
export interface SentScores {
  classKey: string
  device: string
  judge: string
  rows: SentRow[]
  sentAt: string
}

/** One line of published placings. No score: scores and cards are never public. */
export interface PublicPlacing {
  place: number | null
  tied: boolean
  back_no: string
  rider: string
  horse: string
}

export interface PublishedClass {
  classKey: string
  placings: PublicPlacing[]
  publishedAt: string
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
  /** A judging device sends a class as it has it. Needs no sign-in. Throws when it does not arrive. */
  sendClassScores(send: { showId: string; classKey: string; device: string; judge: string; rows: SentRow[] }): Promise<void>
  /** Show admins only: every send for a show, newest first. */
  listClassScores(showId: string): Promise<SentScores[]>
  /** Show admins only: publish, or replace, a class's placings. */
  publishPlacings(showId: string, classKey: string, placings: PublicPlacing[]): Promise<void>
  /** Show admins only: take a class's placings down. */
  removePlacings(showId: string, classKey: string): Promise<void>
  /** Anyone: the placings published for a show. */
  listPlacings(showId: string): Promise<PublishedClass[]>
  /** Store a picture of a pattern book page at this path. Throws when the server refuses. */
  uploadPatternPage(path: string, image: Blob): Promise<void>
  /** The public address of a stored picture. */
  patternPageUrl(path: string): string
  /** Have the server fetch a link-shared Google Sheet as an Excel file. Returns the file's bytes. */
  fetchWorkbook(link: string): Promise<ArrayBuffer>
  /** Send a pattern book PDF, as base64, to the reader. Returns what it found, not yet checked. */
  readPatternBook(pdfBase64: string): Promise<unknown>
}
