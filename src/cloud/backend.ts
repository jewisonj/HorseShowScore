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
  /** The judge's note for the rider. For the show office, until it releases the score cards. */
  note?: string
  /** The card itself, for riders who rode: what the office releases as a score card. */
  card?: SentCard
  /** How many re-rides this rider has had in the class. The row is the latest ride. */
  reride?: number
}

/** A rider's card as scored: each maneuver box, the boxes outside the maneuvers, and the penalties. Half points. */
export interface SentCard {
  boxes: (number | null)[]
  extras: Record<string, number | null>
  penalties: { half: number; box: number; reason?: string; circled?: boolean }[]
}

/** One rider's released score card. Public once the show office releases the class. */
export interface PublicCard extends SentCard {
  place: number | null
  tied: boolean
  back_no: string
  rider: string
  horse: string
  score: number | null
  mark: string
  note: string
}

export interface ReleasedCards {
  classKey: string
  cards: PublicCard[]
  publishedAt: string
}

/** What one judging device last sent for one class. */
export interface SentScores {
  classKey: string
  device: string
  judge: string
  /** Which judge's seat sent it. Null when a signed-in show admin did. */
  seatNo: number | null
  /** The judge has marked the class finished. */
  finished: boolean
  rows: SentRow[]
  sentAt: string
}

/** The kinds of seat that sign on to a show with a PIN. */
export type SeatRole = 'judge' | 'office' | 'steward'

/** A seat of a show that signs on with a PIN: a judge (or scribe), the show office, or a steward. */
export interface SeatPin {
  role: SeatRole
  seatNo: number
  pin: string
}

/**
 * A rider on the riders list, with the two marks the horse draw works from.
 * Never a height or a weight: a yes or no, and a group of 1, 2 or 3. Only show
 * admins see the list, and a coach sees the riders of their own team.
 */
export interface RosterRider {
  backNo: string
  rider: string
  team: string
  height: boolean
  group: 1 | 2 | 3
}

/**
 * A horse on the horses list, with what the horse draw needs to know about it.
 * A horse is its name together with who provides it. Only show admins see the list.
 */
export interface StableHorse {
  name: string
  provider: string
  takesHeight: boolean
  /** The heaviest weight group this horse carries. */
  maxGroup: 1 | 2 | 3
}

/** A team and the PIN its coach signs on with. Null when the team has no coach PIN. */
export interface TeamPin {
  team: string
  pin: string | null
}

/** A steward's request to the judge for a re-ride. It names the class and the back number, never the rider. */
export interface RerideAsk {
  id: string
  classKey: string
  backNo: string
  reason: string
  status: 'asked' | 'approved' | 'denied'
  askedAt: string
  decidedAt: string | null
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
  /** Which seat a PIN opens in a show, or null for a wrong PIN. Throws when the server refuses or cannot be reached. */
  checkPin(showId: string, pin: string): Promise<{ role: SeatRole; seatNo: number } | null>
  /** Show admins only: the seats of a show and their PINs. */
  listSeats(showId: string): Promise<SeatPin[]>
  /** Show admins only: set the seats of a show and their PINs, replacing what was there. */
  replaceSeats(showId: string, seats: SeatPin[]): Promise<void>
  /**
   * A judging device sends a class as it has it, with the judge's PIN. A
   * signed-in show admin sends with an empty PIN. Throws when it does not arrive.
   */
  sendClassScores(send: { showId: string; pin: string; classKey: string; device: string; judge: string; rows: SentRow[]; finished: boolean }): Promise<'ok' | 'wrong_pin' | 'not_published'>
  /** The office PIN, or a signed-in show admin with an empty PIN: every send for a show, newest first. Anyone else gets nothing. */
  listClassScores(showId: string, pin: string): Promise<SentScores[]>
  /** The office PIN, or a signed-in show admin with an empty PIN: publish, or replace, a class's placings. */
  publishPlacings(showId: string, classKey: string, placings: PublicPlacing[], pin: string): Promise<'ok' | 'wrong_pin'>
  /** The office PIN, or a signed-in show admin with an empty PIN: take a class's placings down. */
  removePlacings(showId: string, classKey: string, pin: string): Promise<'ok' | 'wrong_pin'>
  /** The office PIN, or a signed-in show admin with an empty PIN: release, or replace, a class's score cards. */
  releaseCards(showId: string, classKey: string, cards: PublicCard[], pin: string): Promise<'ok' | 'wrong_pin'>
  /** The office PIN, or a signed-in show admin with an empty PIN: take a class's score cards down. */
  takeDownCards(showId: string, classKey: string, pin: string): Promise<'ok' | 'wrong_pin'>
  /** The steward PIN, or a signed-in show admin with an empty PIN: ask the judge for a re-ride. */
  askReride(showId: string, pin: string, classKey: string, backNo: string, reason: string): Promise<'ok' | 'wrong_pin' | 'not_published' | 'already_asked' | 'too_many'>
  /** Any PIN of the show, or a signed-in show admin with an empty PIN: the re-rides asked for, oldest first. */
  listRerideAsks(showId: string, pin: string): Promise<RerideAsk[] | 'wrong_pin'>
  /** A judge PIN, or a signed-in show admin with an empty PIN: approve or deny an ask. */
  decideReride(showId: string, pin: string, id: string, approve: boolean): Promise<'ok' | 'wrong_pin' | 'already_decided' | 'not_found'>
  /** Show admins only: everyone on the riders list. */
  listRiders(): Promise<RosterRider[]>
  /** Show admins only: add riders, or replace the ones with the same back number. */
  putRiders(riders: RosterRider[]): Promise<void>
  /** Show admins only: every horse on the horses list. */
  listHorses(): Promise<StableHorse[]>
  /** Show admins only: add horses, or replace the ones with the same name and provider. */
  putHorses(horses: StableHorse[]): Promise<void>
  /** Show admins only: the teams and their coach PINs. */
  listTeams(): Promise<TeamPin[]>
  /** Show admins only: add a team or change its coach PIN. */
  putTeam(team: string, pin: string | null): Promise<void>
  /** A coach PIN: the team it opens and that team's riders. Null for a wrong PIN. Throws when the server refuses or cannot be reached. */
  coachRiders(pin: string): Promise<{ team: string; riders: RosterRider[] } | null>
  /** A coach PIN: set the marks of one of that team's riders. */
  coachSetMark(pin: string, backNo: string, height: boolean, group: 1 | 2 | 3): Promise<'ok' | 'wrong_pin' | 'not_yours'>
  /** Anyone: the score cards released for a show. */
  listCards(showId: string): Promise<ReleasedCards[]>
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
