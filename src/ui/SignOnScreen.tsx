import { useEffect, useState } from 'react'
import { refreshShowsIfStale, startCloud, useCloud } from '../cloud/cloud'
import { signOn } from '../cloud/seat'
import { useCloudCache } from '../data/cloudShows'
import { Screen, go } from './bits'
import { showDates } from './Home'

type Role = 'judge' | 'office'
const ROLE_WORDS: Record<Role, { title: string; does: string }> = {
  judge: { title: 'Judge or scribe', does: 'Enter scores and mark a class finished.' },
  office: { title: 'Show office', does: 'See the scores and publish placings.' },
}

/**
 * The first screen where the app has a server: say who you are.
 * A judge or scribe and the show office sign on with the PIN the show admin
 * gave them. An admin signs in with an account. The public needs nothing.
 */
export function SignOnScreen() {
  const cloud = useCloud()
  const cache = useCloudCache()
  const [role, setRole] = useState<Role | null>(null)
  const shows = cache.shows.filter((s) => cache.onServer.includes(s.id))
  const [showId, setShowId] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    void startCloud().then(refreshShowsIfStale)
  }, [])
  const chosen = shows.find((s) => s.id === showId) ?? (shows.length === 1 ? shows[0] : undefined)

  if (role === null) {
    return (
      <Screen title="Horse Show Scorer" sub="Who is using this device?">
        <div className="stack role-list">
          {(['judge', 'office'] as Role[]).map((r) => (
            <button key={r} className="btn btn-wide role" onClick={() => setRole(r)}>
              <strong>{ROLE_WORDS[r].title}</strong>
              <span>{ROLE_WORDS[r].does} Needs the PIN from the show admin.</span>
            </button>
          ))}
          <button className="btn btn-wide role" onClick={() => go('/account')}>
            <strong>Admin</strong>
            <span>Set up shows, set PINs, do everything. Signs in with an email and password.</span>
          </button>
          <button className="btn btn-wide role" onClick={() => go('/public')}>
            <strong>Rider, coach or spectator</strong>
            <span>See the classes, draws, patterns and placings. No sign-on.</span>
          </button>
        </div>
        {cloud.user && !cloud.admin && <p className="hint">Signed in as {cloud.user.email}. That account is not on the list of show admins.</p>}
      </Screen>
    )
  }

  return (
    <Screen title={ROLE_WORDS[role].title} sub="Sign on with your PIN">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy || !chosen) return
          setBusy(true)
          setProblem('')
          const got = await signOn(chosen.id, pin)
          setBusy(false)
          if (!got.ok) {
            setProblem(got.error)
            return
          }
          setPin('')
          go(got.seat.role === 'office' ? `/s/${chosen.id}/results` : `/s/${chosen.id}`)
        }}
      >
        {shows.length === 0 ? (
          <p className="empty">{cloud.check === 'failed' ? 'Could not reach the server. Signing on needs a connection.' : cloud.check === 'ok' ? 'No shows are published yet.' : 'Looking for shows.'}</p>
        ) : (
          <label className="field">
            <span>Show</span>
            <select value={chosen?.id ?? ''} onChange={(e) => setShowId(e.target.value)} required>
              {shows.length > 1 && <option value="">Choose the show</option>}
              {shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}, {showDates(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>PIN</span>
          <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
        </label>
        <button className="btn btn-primary btn-wide" type="submit" disabled={busy || !chosen || pin.length < 4}>
          {busy ? 'Checking the PIN' : 'Sign on'}
        </button>
        <button className="btn" type="button" onClick={() => setRole(null)}>
          Back
        </button>
      </form>
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      <p className="hint">The show admin sets the PINs. Each judge has their own, so their scores are kept apart.</p>
    </Screen>
  )
}
