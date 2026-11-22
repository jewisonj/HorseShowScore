import { useEffect, useState } from 'react'
import type { RosterRider } from '../cloud/backend'
import { startCloud, useCloud } from '../cloud/cloud'
import { coachMark, coachSignOff, coachSignOn, loadCoachRiders, useCoach } from '../cloud/roster'
import { BackNumber, Screen, go } from './bits'
import { RiderMarks } from './RidersScreen'

/**
 * A coach signs on with their team's PIN, sees their own riders and sets each
 * one's marks for the horse draw: height rider yes or no, and weight group.
 * No heights, no weights, no scores, and nobody else's riders.
 */
export function CoachScreen() {
  const cloud = useCloud()
  const coach = useCoach()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [riders, setRiders] = useState<RosterRider[] | null>(null)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    void startCloud()
  }, [])
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

  if (!coach) {
    return (
      <Screen title="Coach" sub="Sign on with your team's PIN" backTo="/" backLabel="Back">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy) return
            setBusy(true)
            setProblem('')
            const got = await coachSignOn(pin)
            setBusy(false)
            if (!got.ok) {
              setProblem(got.error)
              return
            }
            setPin('')
            setRiders(got.riders)
          }}
        >
          <label className="field">
            <span>Coach PIN</span>
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <button className="btn btn-primary btn-wide" type="submit" disabled={busy || pin.length < 6}>
            {busy ? 'Checking the PIN' : 'Sign on'}
          </button>
        </form>
        {problem && (
          <p className="warning" role="alert">
            {problem}
          </p>
        )}
        <p className="hint">The show admin gives each team's coach a PIN. It opens that team's riders and nothing else.</p>
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

  return (
    <Screen title={coach.team} sub="Coach">
      <p className="hint">
        Mark your height riders and each rider's weight group. The horse draw uses these to give each rider a horse they
        fit. Only you and the show admins see them. They are never published.
      </p>
      {riders === null && !problem && <p className="empty">Looking for your riders.</p>}
      {riders !== null && riders.length === 0 && <p className="empty">No riders are listed for your team yet. The show admin adds them from the show's sheet.</p>}
      {riders !== null && riders.length > 0 && (
        <ul className="list draw-riders">
          {riders.map((r) => (
            <li key={r.backNo} className="draw-rider">
              <BackNumber value={r.backNo} size="sm" />
              <strong className="rider-name">{r.rider || 'Rider not named'}</strong>
              <RiderMarks rider={r} onChange={(height, group) => void mark(r, height, group)} />
            </li>
          ))}
        </ul>
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
            coachSignOff()
            setRiders(null)
            go('/')
          }}
        >
          Sign off
        </button>
      </div>
    </Screen>
  )
}
