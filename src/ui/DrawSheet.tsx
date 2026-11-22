import { useEffect, useState } from 'react'
import type { PublicPlacing } from '../cloud/backend'
import { refreshShows, refreshShowsIfStale, useCloud } from '../cloud/cloud'
import { loadPlacings } from '../cloud/scores'
import { classKey, formatDate, type ShowClass, type ShowFile } from '../data/fixture'
import { go } from './bits'
import { showDates, whenChecked } from './Home'
import { usePublishedShows } from './PublicScreens'

/**
 * A class laid out the way the show's sheet has it: a blue band with the
 * class, then draw place, back number, rider and horse, with the alternates
 * underneath. Once the class's placings are published the table turns into
 * the placings: place, back number, rider and horse, first place first.
 *
 * It shows only what is published, which anyone may see. The rows of the
 * coach's own riders are marked on the coach's own device, and a horse their
 * own school brings is in red, so they know to have it ready for a class even
 * when no rider of theirs is in it (owner, 2026-11-22).
 */
export function DrawTable({ cls, mine, horses, placings }: { cls: ShowClass; mine: Set<string>; horses?: Set<string>; placings?: PublicPlacing[] }) {
  /** A horse cell: red, and said aloud, when the coach's school brings that horse. `horses` holds names in small letters. */
  const horseCell = (name: string, key?: string) => {
    const theirs = name !== '' && horses !== undefined && horses.has(name.toLowerCase())
    return (
      <td key={key} className={theirs ? 'sheet-draw-ourhorse' : undefined}>
        {name}
        {theirs && <span className="sr-only"> (your horse)</span>}
      </td>
    )
  }
  const riders = [...cls.entries].sort((a, b) => a.draw - b.draw)
  const drawn = riders.some((r) => r.horse)
  const placed = placings !== undefined && placings.length > 0
  return (
    <table className={placed ? 'sheet-draw sheet-draw-placed' : 'sheet-draw'}>
      <caption>
        {cls.id}. {cls.name}
        {placed && <span className="sheet-draw-note"> Placings</span>}
        {!placed && riders.length > 0 && !drawn && <span className="sheet-draw-note"> Horses not drawn yet</span>}
      </caption>
      <thead>
        <tr>
          <th scope="col">{placed ? 'Place' : 'Draw'}</th>
          <th scope="col">Back #</th>
          <th scope="col">Rider</th>
          <th scope="col">Horse</th>
        </tr>
      </thead>
      <tbody>
        {!placed && riders.length === 0 && (
          <tr>
            <td colSpan={4} className="sheet-draw-empty">
              No riders listed yet.
            </td>
          </tr>
        )}
        {placed
          ? placings.map((r) => {
              const yours = mine.has(r.back_no)
              return (
                <tr key={r.back_no} className={yours ? 'sheet-draw-mine' : undefined}>
                  <td>{r.place === null ? 'No place' : `${r.place}${r.tied ? ' tie' : ''}`}</td>
                  <td>{r.back_no}</td>
                  <td>
                    {r.rider || 'Rider not named'}
                    {yours && <span className="sr-only"> (your rider)</span>}
                  </td>
                  {horseCell(r.horse)}
                </tr>
              )
            })
          : riders.map((r) => {
              const yours = mine.has(r.back_no)
              return (
                <tr key={`${r.draw}:${r.back_no}`} className={yours ? 'sheet-draw-mine' : undefined}>
                  <td>{r.draw}</td>
                  <td>{r.back_no}</td>
                  <td>
                    {r.rider || 'Rider to be named'}
                    {yours && <span className="sr-only"> (your rider)</span>}
                  </td>
                  {horseCell(r.horse)}
                </tr>
              )
            })}
        {!placed &&
          (cls.alternates ?? []).map((horse, i) => (
            <tr key={`alt:${i}:${horse}`} className="sheet-draw-alt">
              <td colSpan={3}>Alternate</td>
              {horseCell(horse)}
            </tr>
          ))}
      </tbody>
    </table>
  )
}

const lastDate = (show: ShowFile): string => {
  const dates = show.meets.map((m) => m.date).filter(Boolean).sort()
  return dates.length ? dates[dates.length - 1] : ''
}

/** Today as the shows write their dates: 2026-11-22, by this device's clock. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The show a coach most likely means: today's, else the next one coming, else the newest. */
export function showForToday(shows: ShowFile[], day = today()): ShowFile | undefined {
  const newestFirst = [...shows].sort((a, b) => lastDate(b).localeCompare(lastDate(a)))
  return newestFirst.find((s) => s.meets.some((m) => m.date === day)) ?? [...newestFirst].reverse().find((s) => lastDate(s) >= day) ?? newestFirst[0]
}

/** How often an open screen looks for new placings and a changed draw. */
const LOOK_EVERY_MS = 60_000

/**
 * A published show's draw and placings, class by class, for a coach: what they
 * want to see first (owner, 2026-11-22). A class shows its draw until its
 * placings are published, then its placings. `mine` marks the coach's riders,
 * and `horses` (names in small letters) the horses the coach's school brings.
 */
export function ShowDraw({ showId, mine, horses }: { showId?: string; mine: Set<string>; horses?: Set<string> }) {
  const cloud = useCloud()
  const { shows, checkedAt } = usePublishedShows()
  const [checking, setChecking] = useState(false)
  // Published placings, by class key. They arrive class by class through the day.
  const [placings, setPlacings] = useState<Record<string, PublicPlacing[]>>({})
  const listed = [...shows].sort((a, b) => lastDate(b).localeCompare(lastDate(a)))
  const show = listed.find((s) => s.id === showId) ?? showForToday(listed)
  const id = show?.id
  useEffect(() => {
    if (!id) return
    let current = true
    const look = () =>
      void loadPlacings(id).then((got) => {
        if (current && got) setPlacings(Object.fromEntries(got.map((c) => [c.classKey, c.placings])))
      })
    setPlacings({})
    look()
    const timer = window.setInterval(() => {
      look()
      void refreshShowsIfStale()
    }, LOOK_EVERY_MS)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [id])

  if (!show) {
    return (
      <p className="empty">
        {cloud.check === 'failed' ? 'Could not reach the server. Check the connection and try again.' : cloud.check === 'ok' ? 'No show is published yet.' : 'Looking for the show.'}
      </p>
    )
  }
  const yours = show.meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.filter((e) => mine.has(e.back_no)).length, 0), 0)
  const theirHorses = horses ?? new Set<string>()
  const horseRides = show.meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.filter((e) => e.horse && theirHorses.has(e.horse.toLowerCase())).length, 0), 0)
  const placedCount = show.meets.reduce((n, m) => n + m.classes.filter((c) => (placings[classKey(m.id, c.id)] ?? []).length > 0).length, 0)
  return (
    <>
      {listed.length > 1 ? (
        <label className="field">
          <span>Show</span>
          <select value={show.id} onChange={(e) => go(`/coach/draw/${encodeURIComponent(e.target.value)}`)}>
            {listed.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}, {showDates(s)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h2>
          {show.name}, {showDates(show)}
        </h2>
      )}
      <p className="hint">
        {yours > 0 ? `Your riders are marked: ${yours === 1 ? '1 ride' : `${yours} rides`} in this show. ` : ''}
        {theirHorses.size > 0 ? `The horses your school brings are in red: ${horseRides === 1 ? '1 ride' : `${horseRides} rides`} to have them ready for. ` : ''}
        Each class shows its draw, then its placings once the show office posts them.
        {placedCount > 0 ? ` Placings are in for ${placedCount === 1 ? '1 class' : `${placedCount} classes`}.` : ''}
        {checkedAt ? ` Checked ${whenChecked(checkedAt)}.` : ''}
      </p>
      <button
        className="btn"
        disabled={checking}
        onClick={async () => {
          setChecking(true)
          const [, got] = await Promise.all([refreshShows(), loadPlacings(show.id)])
          if (got) setPlacings(Object.fromEntries(got.map((c) => [c.classKey, c.placings])))
          setChecking(false)
        }}
      >
        {checking ? 'Checking' : 'Check for changes'}
      </button>
      {show.meets.map((meet) => (
        <section key={meet.id}>
          {show.meets.length > 1 && (
            <h2>
              {meet.label}
              {meet.date ? `, ${formatDate(meet.date)}` : ''}
            </h2>
          )}
          {meet.classes.length === 0 && <p className="empty">No classes yet.</p>}
          <div className="sheet-draws">
            {meet.classes.map((cls) => (
              <DrawTable key={cls.id} cls={cls} mine={mine} horses={theirHorses} placings={placings[classKey(meet.id, cls.id)]} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
