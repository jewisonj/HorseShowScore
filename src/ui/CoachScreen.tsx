import { useEffect, useState } from 'react'
import type { RosterRider } from '../cloud/backend'
import { startCloud, useCloud } from '../cloud/cloud'
import { coachChoosePin, coachMark, coachSignOff, coachSignOn, coachTeams, loadCoachRiders, useCoach } from '../cloud/roster'
import { BackNumber, Screen, go } from './bits'
import { showForToday } from './DrawSheet'
import { showDates } from './Home'
import { usePublishedShows } from './PublicScreens'
import { RiderMarks } from './RidersScreen'

/** Whether this device last had the height and weight controls open. They take room, so they start closed. */
const MARKS_OPEN_KEY = 'hss.coach.marks.v1'
function marksWereOpen(): boolean {
  try {
    return localStorage.getItem(MARKS_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A coach picks their team and signs on with its PIN, sees their own riders
 * and sets each one's marks for the horse draw: height rider yes or no, and
 * weight group. No heights, no weights, no scores, and nobody else's riders.
 * The marks sit behind a button (owner, 2026-11-22: they take a lot of room).
 * Closed, the screen is the coach's riders and where each one goes today:
 * class, draw place and horse, from the published show.
 *
 * Every coach begins on the same starting PIN. It opens only the step where
 * the coach chooses their own, and stops working for that team once they have.
 */
export function CoachScreen() {
  const cloud = useCloud()
  const coach = useCoach()
  const [teams, setTeams] = useState<string[] | null>(null)
  const [team, setTeam] = useState('')
  const [pin, setPin] = useState('')
  // Choosing a PIN: the team, and the PIN the coach has now.
  const [choosing, setChoosing] = useState<{ team: string; pin: string } | null>(null)
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [riders, setRiders] = useState<RosterRider[] | null>(null)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState('')
  const [marksOpen, setMarksOpen] = useState(marksWereOpen)
  const { shows } = usePublishedShows()
  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (!cloud.configured || coach) return
    let current = true
    void coachTeams().then((got) => {
      if (!current) return
      if (got.ok) setTeams(got.teams)
      else setProblem(got.error)
    })
    return () => {
      current = false
    }
  }, [cloud.configured, coach === null])
  useEffect(() => {
    if (!coach) return
    let current = true
    void loadCoachRiders().then((got) => {
      if (!current) return
      if (got.ok) setRiders(got.riders)
      else setProblem(got.error)
    })
    return () => {
      current = false
    }
  }, [coach?.team, coach?.pin])

  if (!cloud.configured) {
    return (
      <Screen title="Coach" backTo="/" backLabel="Back">
        <p className="hint">A coach's riders are kept on the server. This copy of the app has none.</p>
      </Screen>
    )
  }

  if (choosing) {
    const first = !coach
    return (
      <Screen title={choosing.team} sub="Choose your own PIN">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy) return
            if (next !== again) {
              setProblem('The two PINs are not the same. Type them again.')
              return
            }
            setBusy(true)
            setProblem('')
            const wrong = await coachChoosePin(choosing.team, choosing.pin, next)
            setBusy(false)
            if (wrong) {
              setProblem(wrong)
              return
            }
            setChoosing(null)
            setNext('')
            setAgain('')
            setPin('')
            setSaved('Your PIN is saved. Use it the next time you sign on.')
          }}
        >
          <p className="hint">
            {first ? 'Before your riders show, choose a PIN of your own. ' : ''}4 to 8 digits. You sign on with it from now on, at every show. If you forget it, the show
            admin can start your team again.
          </p>
          <label className="field">
            <span>New PIN</span>
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <label className="field">
            <span>New PIN again</span>
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <button className="btn btn-primary btn-wide" type="submit" disabled={busy || next.length < 4 || again.length < 4}>
            {busy ? 'Saving the PIN' : 'Save my PIN'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setChoosing(null)
              setNext('')
              setAgain('')
              setProblem('')
            }}
          >
            {first ? 'Back' : 'Keep the PIN I have'}
          </button>
        </form>
        {problem && (
          <p className="warning" role="alert">
            {problem}
          </p>
        )}
      </Screen>
    )
  }

  if (!coach) {
    return (
      <Screen title="Coach" sub="Pick your team and sign on" backTo="/" backLabel="Back">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy) return
            setBusy(true)
            setProblem('')
            setSaved('')
            const got = await coachSignOn(team, pin)
            setBusy(false)
            if (!got.ok && got.choosePin) {
              setChoosing({ team, pin })
              return
            }
            if (!got.ok) {
              setProblem(got.error)
              return
            }
            setPin('')
            setRiders(got.riders)
          }}
        >
          <label className="field">
            <span>Your team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} required>
              <option value="">{teams === null ? 'Looking for the teams' : 'Pick your team'}</option>
              {(teams ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Coach PIN</span>
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <button className="btn btn-primary btn-wide" type="submit" disabled={busy || team === '' || pin.length < 4}>
            {busy ? 'Checking the PIN' : 'Sign on'}
          </button>
        </form>
        {problem && (
          <p className="warning" role="alert">
            {problem}
          </p>
        )}
        {teams !== null && teams.length === 0 && <p className="empty">No team's coach can sign on yet. The show admin turns that on for each team.</p>}
        <p className="hint">
          The show admin tells you the PIN to start with. The first time you sign on you choose your own, and after that only yours opens your team's
          riders.
        </p>
      </Screen>
    )
  }

  async function mark(rider: RosterRider, height: boolean, group: 1 | 2 | 3) {
    const before = riders
    setRiders((list) => (list ?? []).map((r) => (r.backNo === rider.backNo ? { ...r, height, group } : r)))
    setProblem('')
    setSaved('')
    const wrong = await coachMark(rider.backNo, height, group)
    if (wrong) {
      setProblem(`${rider.backNo} was not saved. ${wrong}`)
      setRiders(before)
    } else setSaved(`Saved for ${rider.backNo}.`)
  }

  // Where each rider goes today, from the published show. Public already, shown here beside the coach's own riders.
  const today = showForToday(shows)
  const ridesOf = (backNo: string) =>
    today ? today.meets.flatMap((m) => m.classes.flatMap((c) => c.entries.filter((e) => e.back_no === backNo).map((e) => ({ key: `${m.id}:${c.id}`, cls: c.name, draw: e.draw, horse: e.horse })))) : []
  const anyRides = (riders ?? []).some((r) => ridesOf(r.backNo).length > 0)

  return (
    <Screen title={coach.team} sub="Coach">
      {riders === null && !problem && <p className="empty">Looking for your riders.</p>}
      {riders !== null && riders.length === 0 && <p className="empty">No riders are listed for your team yet. The show admin adds them from the show's sheet.</p>}
      {riders !== null && riders.length > 0 && (
        <>
          {today && anyRides && (
            <p className="hint">
              Your riders in {today.name}, {showDates(today)}: each class with its draw place and horse, as the show has published it.
            </p>
          )}
          <button
            className="btn coach-marks-button"
            aria-expanded={marksOpen}
            onClick={() => {
              const next = !marksOpen
              setMarksOpen(next)
              try {
                localStorage.setItem(MARKS_OPEN_KEY, next ? '1' : '0')
              } catch {
                // It still opens and closes for this visit.
              }
            }}
          >
            {marksOpen ? 'Hide height and weight' : 'Set height and weight'}
          </button>
          {marksOpen && (
            <p className="hint">
              Mark your height riders and each rider's weight group. The horse draw uses these to give each rider a horse
              they fit. Only you and the show admins see them. They are never published.
            </p>
          )}
          <ul className="list draw-riders">
            {riders.map((r) => {
              const rides = ridesOf(r.backNo)
              return (
                <li key={r.backNo} className="draw-rider">
                  <BackNumber value={r.backNo} size="sm" />
                  <strong className="rider-name">{r.rider || 'Rider not named'}</strong>
                  {marksOpen ? (
                    <RiderMarks rider={r} onChange={(height, group) => void mark(r, height, group)} />
                  ) : (
                    <span className="muted coach-marks">
                      {r.height ? 'Height rider, group ' : 'Group '}
                      {r.group}
                    </span>
                  )}
                  {rides.length > 0 && (
                    <ul className="coach-rides" aria-label={`Rides of ${r.backNo}`}>
                      {rides.map((x) => (
                        <li key={x.key}>
                          <span>{x.cls}</span>
                          <strong>{x.horse ? `Draw ${x.draw}, ${x.horse}` : 'No horse yet'}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      {saved && (
        <p className="hint" role="status">
          {saved}
        </p>
      )}
      <div className="stack">
        <button className="btn btn-primary btn-wide" onClick={() => go('/coach/draw')}>
          See the draw
        </button>
        <button
          className="btn"
          onClick={() => {
            setProblem('')
            setSaved('')
            setChoosing({ team: coach.team, pin: coach.pin })
          }}
        >
          Change my PIN
        </button>
        <button
          className="btn"
          onClick={() => {
            coachSignOff()
            setRiders(null)
            setTeams(null)
            go('/')
          }}
        >
          Sign off
        </button>
      </div>
    </Screen>
  )
}
