import { useEffect, useState } from 'react'
import { refreshShows, useCloud } from '../cloud/cloud'
import { loadCoachRiders, useCoach } from '../cloud/roster'
import { formatDate, type ShowClass, type ShowFile } from '../data/fixture'
import { Screen, go } from './bits'
import { showDates, whenChecked } from './Home'
import { usePublishedShows } from './PublicScreens'

/**
 * The draw laid out the way the show's sheet has it: one table for each class,
 * a blue band with the class, then draw place, back number, rider and horse,
 * with the alternates underneath.
 *
 * It shows only what is published, which anyone may see. The rows of the
 * coach's own riders are marked on the coach's own device.
 */
export function DrawTable({ cls, mine }: { cls: ShowClass; mine: Set<string> }) {
  const riders = [...cls.entries].sort((a, b) => a.draw - b.draw)
  const drawn = riders.some((r) => r.horse)
  return (
    <table className="sheet-draw">
      <caption>
        {cls.id}. {cls.name}
        {riders.length > 0 && !drawn && <span className="sheet-draw-note"> Horses not drawn yet</span>}
      </caption>
      <thead>
        <tr>
          <th scope="col">Draw</th>
          <th scope="col">Back #</th>
          <th scope="col">Rider</th>
          <th scope="col">Horse</th>
        </tr>
      </thead>
      <tbody>
        {riders.length === 0 && (
          <tr>
            <td colSpan={4} className="sheet-draw-empty">
              No riders listed yet.
            </td>
          </tr>
        )}
        {riders.map((r) => {
          const yours = mine.has(r.back_no)
          return (
            <tr key={`${r.draw}:${r.back_no}`} className={yours ? 'sheet-draw-mine' : undefined}>
              <td>{r.draw}</td>
              <td>{r.back_no}</td>
              <td>
                {r.rider || 'Rider to be named'}
                {yours && <span className="sr-only"> (your rider)</span>}
              </td>
              <td>{r.horse}</td>
            </tr>
          )
        })}
        {(cls.alternates ?? []).map((horse, i) => (
          <tr key={`alt:${i}:${horse}`} className="sheet-draw-alt">
            <td colSpan={3}>Alternate</td>
            <td>{horse}</td>
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

/** A coach looks over the draw of a published show, as at the coaches' meeting. */
export function CoachDrawScreen({ showId }: { showId?: string }) {
  const cloud = useCloud()
  const coach = useCoach()
  const { shows, checkedAt } = usePublishedShows()
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!coach) return
    let current = true
    void loadCoachRiders().then((got) => {
      if (current && got.ok) setMine(new Set(got.riders.map((r) => r.backNo)))
    })
    return () => {
      current = false
    }
  }, [coach?.team, coach?.pin])

  const listed = [...shows].sort((a, b) => lastDate(b).localeCompare(lastDate(a)))
  const show = listed.find((s) => s.id === showId) ?? showForToday(listed)
  if (!show) {
    return (
      <Screen title="The draw" backTo="/coach" backLabel="My riders">
        <p className="empty">
          {cloud.check === 'failed' ? 'Could not reach the server. Check the connection and try again.' : cloud.check === 'ok' ? 'No show is published yet.' : 'Looking for the show.'}
        </p>
      </Screen>
    )
  }
  const yours = show.meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.filter((e) => mine.has(e.back_no)).length, 0), 0)
  return (
    <Screen title="The draw" sub={[show.name, showDates(show)].filter(Boolean).join(', ')} backTo="/coach" backLabel="My riders" wide>
      {listed.length > 1 && (
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
      )}
      <p className="hint">
        {yours > 0 ? `Your riders are marked: ${yours === 1 ? '1 ride' : `${yours} rides`} in this show. ` : ''}
        This is the draw as the show has published it.{checkedAt ? ` Checked ${whenChecked(checkedAt)}.` : ''}
      </p>
      <button
        className="btn"
        disabled={checking}
        onClick={async () => {
          setChecking(true)
          await refreshShows()
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
              <DrawTable key={cls.id} cls={cls} mine={mine} />
            ))}
          </div>
        </section>
      ))}
    </Screen>
  )
}
